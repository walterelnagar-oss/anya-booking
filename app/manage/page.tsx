'use client'

import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Booking = {
  booking_id: string
  service_option_id: number
  service_name: string
  duration_minutes: number
  price_chf: number
  starts_at: string
  ends_at: string
  status: string
  customer_name: string
  preferred_language: string
}

export default function ManageBookingPage() {
  const [token, setToken] = useState('')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const minDate = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }),
    []
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token') || ''
    setToken(t)
    if (!t) {
      setError('Lien de réservation invalide.')
      setLoading(false)
      return
    }
    loadBooking(t)
  }, [])

  async function loadBooking(t = token) {
    setLoading(true)
    setError('')
    const { data, error } = await supabase.rpc('get_public_booking', { p_token: t })
    if (error) setError('Impossible de charger ce rendez-vous.')
    else if (!data?.length) setError('Rendez-vous introuvable.')
    else setBooking(data[0] as Booking)
    setLoading(false)
  }

  async function loadSlots(d: string) {
    if (!token || !d) return
    setDate(d)
    setSlots([])
    setMessage('')
    setError('')
    setLoadingSlots(true)
    const { data, error } = await supabase.rpc('get_reschedule_slots', {
      p_token: token,
      p_date: d,
    })
    if (error) setError('Impossible de charger les créneaux.')
    else setSlots((data || []).map((x: any) => x.slot_start).filter(Boolean))
    setLoadingSlots(false)
  }

  async function cancelBooking() {
    if (!booking || booking.status !== 'confirmed') return
    if (!window.confirm('Annuler ce rendez-vous ?')) return
    setMessage('')
    setError('')
    const { error } = await supabase.rpc('cancel_public_booking', { p_token: token })
    if (error) setError('Ce rendez-vous ne peut plus être annulé.')
    else {
      setMessage('Votre rendez-vous a été annulé.')
      void supabase.functions.invoke('booking-email', { body: { action: 'cancelled', token } })
      await loadBooking()
    }
  }

  async function reschedule(slot: string) {
    setMessage('')
    setError('')
    const { error } = await supabase.rpc('reschedule_public_booking', {
      p_token: token,
      p_new_start: slot,
    })
    if (error) {
      setError(error.message.includes('slot_unavailable') ? 'Ce créneau vient d’être pris. Choisissez-en un autre.' : 'Impossible de déplacer le rendez-vous.')
      await loadSlots(date)
      return
    }
    setMessage('Votre rendez-vous a été déplacé.')
    setSlots([])
    setDate('')
    void supabase.functions.invoke('booking-email', { body: { action: 'rescheduled', token } })
    await loadBooking()
  }

  if (loading) return <main><p>Chargement…</p></main>

  return (
    <main>
      <div className="brand">
        <p>Genève</p>
        <h1>Gérer votre rendez-vous</h1>
        <div className="muted">Anya Thai Massage</div>
      </div>

      {error && <p className="notice errorNotice">{error}</p>}
      {message && <p className="notice successNotice">{message}</p>}

      {booking && (
        <div className="card bookingSummary">
          <strong>{booking.service_name}</strong>
          <p>{booking.duration_minutes} min · CHF {Number(booking.price_chf).toFixed(0)}</p>
          <p>
            {new Date(booking.starts_at).toLocaleDateString('fr-CH', {
              timeZone: 'Europe/Zurich',
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
            })}
            {' · '}
            {new Date(booking.starts_at).toLocaleTimeString('fr-CH', {
              timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
            })}
          </p>
          <p className="muted">Statut: {booking.status}</p>
        </div>
      )}

      {booking?.status === 'confirmed' && (
        <>
          <h2>Déplacer le rendez-vous</h2>
          <input type="date" min={minDate} value={date} onChange={e => loadSlots(e.target.value)} />
          {date && (loadingSlots ? <p className="muted">Recherche des créneaux…</p> : slots.length ? (
            <div className="grid">
              {slots.map(slot => (
                <button key={slot} onClick={() => reschedule(slot)}>
                  {new Date(slot).toLocaleTimeString('fr-CH', {
                    timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
                  })}
                </button>
              ))}
            </div>
          ) : <p className="muted">Aucun créneau disponible ce jour.</p>)}

          <h2>Annuler</h2>
          <button className="dangerButton" onClick={cancelBooking}>Annuler ce rendez-vous</button>
        </>
      )}

      {booking && booking.status !== 'confirmed' && (
        <p className="muted">Ce rendez-vous ne peut plus être modifié en ligne.</p>
      )}
    </main>
  )
}
