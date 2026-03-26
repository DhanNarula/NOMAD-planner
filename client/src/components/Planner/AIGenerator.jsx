import React, { useState } from 'react'
import { Sparkles, X, MapPin, Clock, ChevronRight, Loader2, Check, Info } from 'lucide-react'
import { aiApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import Modal from '../shared/Modal'
import { getCategoryIcon } from '../shared/categoryIcons'

export default function AIGenerator({ isOpen, onClose, tripId, days, places, categories, onPlacesAdded }) {
  const { t } = useTranslation()
  const [destination, setDestination] = useState('')
  const [preferences, setPreferences] = useState('')
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleGenerate = async () => {
    if (!destination.trim()) return
    
    setLoading(true)
    setError(null)
    setPlan(null)
    setSaved(false)
    
    try {
      const result = await aiApi.generatePlan({
        tripId,
        destination: destination.trim(),
        days: days?.length || 3,
        preferences: preferences.trim() || undefined,
        existingPlaces: places,
      })
      setPlan(result.plan)
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('ai.generateError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSavePlan = async () => {
    if (!plan) return
    
    setSaving(true)
    try {
      const result = await aiApi.addPlaces({ tripId, plan })
      setSaved(true)
      if (onPlacesAdded) {
        onPlacesAdded(result.places)
      }
      setTimeout(() => {
        onClose()
        resetForm()
      }, 1500)
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('ai.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setDestination('')
    setPreferences('')
    setPlan(null)
    setError(null)
    setSaved(false)
  }

  const handleClose = () => {
    onClose()
    resetForm()
  }

  const getCategoryName = (catId) => {
    const cat = categories?.find(c => c.id === catId)
    return cat?.name || 'attraction'
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('ai.title')} maxWidth={600}>
      <div style={{ padding: '0 4px 8px' }}>
        {!plan ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                {t('ai.destination')} *
              </label>
              <input
                type="text"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder={t('ai.destinationPlaceholder')}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border-primary)', background: 'var(--bg-card)',
                  fontSize: 14, color: 'var(--text-primary)', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                {t('ai.preferences')}
              </label>
              <textarea
                value={preferences}
                onChange={e => setPreferences(e.target.value)}
                placeholder={t('ai.preferencesPlaceholder')}
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border-primary)', background: 'var(--bg-card)',
                  fontSize: 14, color: 'var(--text-primary)', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical',
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px', borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: 16,
              }}>
                <span style={{ fontSize: 13, color: '#ef4444' }}>{error}</span>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading || !destination.trim()}
              style={{
                width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                background: loading || !destination.trim() ? 'var(--bg-tertiary)' : 'var(--accent)',
                color: loading || !destination.trim() ? 'var(--text-faint)' : 'var(--accent-text)',
                fontSize: 14, fontWeight: 600, cursor: loading || !destination.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  {t('ai.generating')}
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  {t('ai.generatePlan')}
                </>
              )}
            </button>

            <div style={{
              marginTop: 16, padding: '12px', borderRadius: 10,
              background: 'var(--bg-tertiary)', display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <Info size={16} style={{ color: 'var(--text-faint)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {t('ai.info')}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Sparkles size={16} style={{ color: '#22c55e' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#22c55e' }}>
                    {t('ai.planReady')}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {plan.length} {t('ai.days')} · {plan.reduce((acc, d) => acc + d.places.length, 0)} {t('ai.places')}
                </span>
              </div>
            </div>

            <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 16 }}>
              {plan.map((dayPlan) => (
                <div key={dayPlan.day} style={{ marginBottom: 16 }}>
                  <div style={{
                    padding: '10px 14px', borderRadius: 10, marginBottom: 8,
                    background: 'var(--bg-tertiary)',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {t('ai.day')} {dayPlan.day}
                    </span>
                  </div>
                  {dayPlan.places.map((place, idx) => {
                    const CatIcon = getCategoryIcon(categories?.find(c => c.id === place.category_id)?.icon || '📍')
                    return (
                      <div key={idx} style={{
                        display: 'flex', gap: 12, padding: '10px 14px',
                        background: 'var(--bg-card)', borderRadius: 10, marginBottom: 6,
                        border: '1px solid var(--border-faint)',
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: 'var(--bg-tertiary)', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <CatIcon size={14} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                              {place.name}
                            </span>
                            <span style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: 'var(--bg-tertiary)', color: 'var(--text-faint)',
                            }}>
                              {place.suggested_time}
                            </span>
                          </div>
                          {place.description && (
                            <span style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block' }}>
                              {place.description}
                            </span>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <Clock size={10} style={{ color: 'var(--text-faint)' }} />
                            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                              ~{place.estimated_duration} min
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {error && (
              <div style={{
                padding: '12px', borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: 16,
              }}>
                <span style={{ fontSize: 13, color: '#ef4444' }}>{error}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={resetForm}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12, border: '1px solid var(--border-primary)',
                  background: 'transparent', color: 'var(--text-primary)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('ai.newPlan')}
              </button>
              <button
                onClick={handleSavePlan}
                disabled={saving || saved}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                  background: saved ? '#22c55e' : saving ? 'var(--bg-tertiary)' : 'var(--accent)',
                  color: saved ? '#fff' : saving ? 'var(--text-faint)' : 'var(--accent-text)',
                  fontSize: 14, fontWeight: 600, cursor: saving || saved ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {saving ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    {t('ai.saving')}
                  </>
                ) : saved ? (
                  <>
                    <Check size={16} />
                    {t('ai.added')}
                  </>
                ) : (
                  <>
                    <MapPin size={16} />
                    {t('ai.addToTrip')}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Modal>
  )
}
