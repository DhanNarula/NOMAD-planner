const express = require('express');
const fetch = require('node-fetch');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'gemini-1.5-flash';
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';

async function callAI(systemPrompt, userPrompt) {
  if (AI_PROVIDER === 'gemini' || AI_BASE_URL.includes('generativelanguage.googleapis.com')) {
    function normalizeModelId(model) {
      if (!model) return model;
      // Accept either "gemini-*" or "models/gemini-*"
      return model.startsWith('models/') ? model.slice('models/'.length) : model;
    }

    function buildGenerateUrl(model) {
      const modelId = normalizeModelId(model);
      // AI_BASE_URL is expected to end with "/models", but keep this tolerant.
      const base = AI_BASE_URL.endsWith('/models') ? AI_BASE_URL : `${AI_BASE_URL.replace(/\/$/, '')}/models`;
      return `${base}/${modelId}:generateContent?key=${AI_API_KEY}`;
    }

    async function listGeminiModels() {
      const base = AI_BASE_URL.endsWith('/models') ? AI_BASE_URL : `${AI_BASE_URL.replace(/\/$/, '')}/models`;
      const url = `${base}?key=${AI_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();rs
    }

    function pickFallbackGeminiModel(modelsResponse) {
      const models = modelsResponse?.models;
      if (!Array.isArray(models) || models.length === 0) return null;

      const supportsGenerate = (m) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent');

      const candidates = models.filter(supportsGenerate);
      if (candidates.length === 0) return null;

      const score = (m) => {
        const name = (m.name || '').toLowerCase(); // e.g. "models/gemini-1.5-flash"
        // Prefer flash > pro/others, and prefer 1.5 (widely available) over newer gated ones.
        if (name.includes('flash') && name.includes('1.5')) return 0;
        if (name.includes('flash')) return 1;
        if (name.includes('1.5')) return 2;
        return 3;
      };

      candidates.sort((a, b) => score(a) - score(b));
      return candidates[0]?.name || null; // usually "models/<id>"
    }

    async function generateWithModel(model) {
      const url = buildGenerateUrl(model);
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          },
        }),
      });
    }

    let response = await generateWithModel(AI_MODEL);

    if (!response.ok) {
      const errorText = await response.text();

      // Some Gemini models (e.g. gemini-2.0-flash) are not available to all/new users.
      // Retry once with a discovered fallback model before failing.
      const isModelNotFoundOrRetired =
        response.status === 404 &&
        (errorText.includes('is not found for API version') ||
          errorText.includes('is no longer available') ||
          errorText.includes('"status": "NOT_FOUND"'));

      if (isModelNotFoundOrRetired) {
        const modelsResponse = await listGeminiModels();
        const discovered = pickFallbackGeminiModel(modelsResponse);
        if (discovered) {
          response = await generateWithModel(discovered);
        }
        if (!response.ok) {
          const fallbackErrorText = await response.text();
          throw new Error(`Gemini API error ${response.status}: ${fallbackErrorText}`);
        }
      } else {
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No response from Gemini');
    return content;
  } else {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content;
  }
}

router.post('/generate-plan', async (req, res) => {
  if (!AI_API_KEY) {
    return res.status(503).json({ error: 'AI service not configured. Please set AI_API_KEY in your environment.' });
  }

  const { tripId, destination, days, preferences, existingPlaces } = req.body;

  if (!destination) {
    return res.status(400).json({ error: 'Destination is required' });
  }

  try {
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    if (!trip || !canAccessTrip(tripId, req.user.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const tripDays = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId);
    const categories = db.prepare('SELECT * FROM categories WHERE user_id = ? OR user_id IS NULL').all(req.user.id);

    const numDays = days || tripDays.length || 3;
    const preferencesText = preferences ? `User preferences: ${preferences}` : '';

    const systemPrompt = `You are a travel planning assistant. Generate a detailed day-by-day itinerary for a trip.
Return a JSON array where each day has:
- day: day number
- places: array of place objects with name, category (matching one of: ${categories.map(c => c.name).join(', ') || 'attraction, restaurant, accommodation, landmark, park, museum, shopping, transport'}), description (brief 1-2 sentences), suggested_time (morning/afternoon/evening), and estimated_duration (in minutes)

Be specific and realistic. Include popular attractions, restaurants, and activities typical for the destination.`;

    const userPrompt = `Plan a ${numDays}-day trip to ${destination}.
${preferencesText}
${existingPlaces?.length ? `Existing places to consider: ${existingPlaces.map(p => p.name).join(', ')}` : ''}
${tripDays.length > 0 ? `Trip dates: ${tripDays[0]?.date || 'TBD'} to ${tripDays[tripDays.length - 1]?.date || 'TBD'}` : ''}

Return ONLY a valid JSON array, no markdown or explanation.`;

    const content = await callAI(systemPrompt, userPrompt);

    let plan;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      } else {
        plan = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const defaultCategoryId = categories.find(c => c.name.toLowerCase() === 'attraction')?.id || null;

    const processedPlan = plan.map(day => ({
      ...day,
      places: day.places.map((place, idx) => ({
        name: place.name,
        description: place.description || '',
        category_id: categories.find(c => c.name.toLowerCase() === (place.category || 'attraction').toLowerCase())?.id || defaultCategoryId,
        suggested_time: place.suggested_time || 'morning',
        estimated_duration: place.estimated_duration || 60,
      })),
    }));

    res.json({
      destination,
      days: numDays,
      plan: processedPlan,
    });
  } catch (error) {
    console.error('AI route error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/add-places', async (req, res) => {
  const { tripId, plan } = req.body;

  if (!tripId || !plan) {
    return res.status(400).json({ error: 'Trip ID and plan are required' });
  }

  try {
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    if (!trip || !canAccessTrip(tripId, req.user.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const days = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId);
    const insertPlace = db.prepare(`
      INSERT INTO places (trip_id, name, description, category_id, notes, place_time, end_time, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAssignment = db.prepare(`
      INSERT INTO day_assignments (day_id, place_id, order_index, notes)
      VALUES (?, ?, ?, ?)
    `);

    const addedPlaces = [];

    for (const dayPlan of plan) {
      const day = days.find(d => d.day_number === dayPlan.day);
      if (!day) continue;

      for (let i = 0; i < dayPlan.places.length; i++) {
        const place = dayPlan.places[i];

        const time = place.suggested_time || 'morning';
        const durationMinutes = Number(place.estimated_duration || 60);

        let startTime = null;
        let endTime = null;

        if (time === 'morning') {
          startTime = '09:00';
          endTime = durationMinutes
            ? `${String(Math.floor(9 + durationMinutes / 60)).padStart(2, '0')}:${String(durationMinutes % 60).padStart(2, '0')}`
            : '11:00';
        } else if (time === 'afternoon') {
          startTime = '14:00';
          endTime = durationMinutes
            ? `${String(Math.floor(14 + durationMinutes / 60)).padStart(2, '0')}:${String(durationMinutes % 60).padStart(2, '0')}`
            : '16:00';
        } else if (time === 'evening') {
          startTime = '18:00';
          endTime = durationMinutes
            ? `${String(Math.floor(18 + durationMinutes / 60)).padStart(2, '0')}:${String(durationMinutes % 60).padStart(2, '0')}`
            : '20:00';
        }

        const notes =
          place.notes || `AI Suggested: ${place.suggested_time || 'flexible'} - ~${durationMinutes} min`;

        const result = insertPlace.run(
          tripId,
          place.name,
          place.description || '',
          place.category_id || null,
          notes,
          startTime,
          endTime,
          durationMinutes
        );

        const placeId = result.lastInsertRowid;
        insertAssignment.run(day.id, placeId, i, notes);

        addedPlaces.push({ id: placeId, name: place.name, day: day.day_number });
      }
    }

    res.json({
      success: true,
      placesAdded: addedPlaces.length,
      places: addedPlaces,
    });
  } catch (error) {
    console.error('Add places error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
