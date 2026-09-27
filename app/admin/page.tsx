'use client'

import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Booking = {
  id: string
  starts_at: string
  service_name_snapshot: string
  duration_minutes_snapshot: number
  price_chf_snapshot: number
  status: string
  source: string
  customers: { first_name: string; last_name: string; email: string; phone: string } | null
}

type ServiceOption = {
  id: number
  duration_minutes: number
  price_chf: number
  services: { name_fr: string } | null
}

type Block = { id: string; starts_at: string; ends_at: string; reason: string | null }

export default function AdminPage() {
  const [ready, setReady] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState('booking@anya-thai-massage.ch')
  const [message, setMessage] = useState('')
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }))
  const [bookings, setBookings] = useState<Booking[]>([])
  const [options, setOptions] = useState<ServiceOption[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [optionId, setOptionId] = useState('')
  const [startAt, setStartAt] = useState('')

  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')
  const [blockReason, setBlockReason] = useState('')

  const timeOptions = useMemo(() => {
    const result: string[] = []
    for (let minutes = 9 * 60; minutes <= 20 * 60; minutes += 15) {
      const h = String(Math.floor(minutes / 60)).padStart(2, '0')
      const m = String(minutes % 60).padStart(2, '0')
      result.push(`${h}:${m}`)
    }
    return result
  }, [])

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setAuthorized(false)
      setReady(true)
      return
    }
    const { data, error } = await supabase.rpc('is_admin')
    setAuthorized(!error && data === true)
    setReady(true)
  }

  useEffect(() => {
    checkAuth()
    const { data: listener } = supabase.auth.onAuthStateChange(() => checkAuth())
    return () => listener.subscription.unsubscribe()
  }, [])

  async function sendMagicLink() {
    setMessage('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/admin`,
      },
    })
    setMessage(error ? error.message : 'Lien de connexion envoyé par e-mail.')
  }

  function localIso(time: string) {
    return new Date(`${date}T${time}:00`).toISOString()
  }

  async function loadData() {
    if (!authorized) return
    const start = new Date(`${date}T00:00:00`).toISOString()
    const end = new Date(`${date}T23:59:59`).toISOString()

    const [{ data: b }, { data: o }, { data: bl }] = await Promise.all([
      supabase
        .from('bookings')
        .select('id,starts_at,service_name_snapshot,duration_minutes_snapshot,price_chf_snapshot,status,source,customers(first_name,last_name,email,phone)')
        .gte('starts_at', start)
        .lte('starts_at', end)
        .order('starts_at'),
      supabase
        .from('service_options')
        .select('id,duration_minutes,price_chf,services(name_fr)')
        .eq('active', true),
      supabase
        .from('blocked_periods')
        .select('id,starts_at,ends_at,reason')
        .lte('starts_at', end)
        .gte('ends_at', start)
        .order('starts_at'),
    ])

    setBookings((b || []) as unknown as Booking[])
    setOptions((o || []) as unknown as ServiceOption[])
    setBlocks((bl || []) as Block[])
  }

  useEffect(() => { loadData() }, [authorized, date])

  const total = useMemo(
    () => bookings.filter(b => b.status !== 'cancelled').reduce((sum, b) => sum + Number(b.price_chf_snapshot), 0),
    [bookings]
  )

  async function createManualBooking() {
    if (!firstName || !lastName || !phone || !customerEmail || !optionId || !startAt) return
    const { error } = await supabase.rpc('admin_create_booking', {
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: customerEmail,
      p_phone: phone,
      p_service_option_id: Number(optionId),
      p_start_at: localIso(startAt),
      p_locale: 'fr',
    })
    if (error) return alert(error.message)
    setFirstName('')
    setLastName('')
    setPhone('')
    setCustomerEmail('')
    setStartAt('')
    await loadData()
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.rpc('admin_set_booking_status', {
      p_booking_id: id,
      p_status: status,
    })
    if (error) return alert(error.message)
    await loadData()
  }

  async function moveBooking(id: string, current: string) {
    const suggested = new Date(current).toLocaleTimeString('fr-CH', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
    })
    const time = prompt('Nouvelle heure (HH:MM, par pas de 15 minutes)', suggested)
    if (!time) return
    if (!timeOptions.includes(time)) return alert('Choisissez une heure par pas de 15 minutes entre 09:00 et 20:00.')
    const { error } = await supabase.rpc('admin_move_booking', {
      p_booking_id: id,
      p_new_start: localIso(time),
    })
    if (error) return alert(error.message)
    await loadData()
  }

  async function addBlock() {
    if (!blockStart || !blockEnd) return
    if (blockEnd <= blockStart) return alert("L'heure de fin doit être après l'heure de début.")
    const { error } = await supabase.rpc('admin_block_period', {
      p_starts_at: localIso(blockStart),
      p_ends_at: localIso(blockEnd),
      p_reason: blockReason || null,
    })
    if (error) return alert(error.message)
    setBlockStart('')
    setBlockEnd('')
    setBlockReason('')
    await loadData()
  }

  async function deleteBlock(id: string) {
    const { error } = await supabase.rpc('admin_delete_block', { p_block_id: id })
    if (error) return alert(error.message)
    await loadData()
  }

  if (!ready) return <main><p>Chargement…</p></main>

  if (!authorized) {
    return (
      <main className="adminWrap">
        <div className="adminLogin">
          <p className="eyebrow">ANYA THAI MASSAGE</p>
          <h1>Espace Anya</h1>
          <p className="muted">Connexion privée par lien e-mail.</p>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="primary" onClick={sendMagicLink}>Recevoir le lien de connexion</button>
          {message && <p>{message}</p>}
        </div>
      </main>
    )
  }

  return (
    <main className="adminWrap">
      <div className="adminHeader">
        <div>
          <p className="eyebrow">ANYA THAI MASSAGE</p>
          <h1>Agenda</h1>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </div>

      <div className="adminToolbar">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <div><strong>{bookings.length}</strong><span> rendez-vous</span></div>
        <div><strong>CHF {total.toFixed(0)}</strong><span> planifiés</span></div>
      </div>

      <section className="adminSection">
        <h2>Rendez-vous</h2>
        {bookings.length === 0 && <p className="muted">Aucun rendez-vous ce jour.</p>}
        <div className="agendaList">
          {bookings.map(b => (
            <article className={`appointment ${b.status}`} key={b.id}>
              <div className="appointmentTime">
                {new Date(b.starts_at).toLocaleTimeString('fr-CH', {
                  timeZone: 'Europe/Zurich',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div className="appointmentBody">
                <strong>{b.customers ? `${b.customers.first_name} ${b.customers.last_name}` : 'Client'}</strong>
                <div>{b.service_name_snapshot} · {b.duration_minutes_snapshot} min · CHF {Number(b.price_chf_snapshot).toFixed(0)}</div>
                {b.customers && <small>{b.customers.phone} · {b.customers.email}</small>}
                <small>{b.source === 'online' ? 'En ligne' : 'Manuel'} · {b.status}</small>
              </div>
              <div className="appointmentActions">
                <button onClick={() => moveBooking(b.id, b.starts_at)}>Déplacer</button>
                {b.status === 'confirmed' && <button onClick={() => setStatus(b.id, 'completed')}>Terminé</button>}
                {b.status === 'confirmed' && <button onClick={() => setStatus(b.id, 'no_show')}>No-show</button>}
                {b.status !== 'cancelled' && <button onClick={() => setStatus(b.id, 'cancelled')}>Annuler</button>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="adminSection twoCol">
        <div>
          <h2>Ajouter un rendez-vous</h2>
          <input placeholder="Prénom" value={firstName} onChange={e => setFirstName(e.target.value)} />
          <input placeholder="Nom" value={lastName} onChange={e => setLastName(e.target.value)} />
          <input placeholder="Téléphone" value={phone} onChange={e => setPhone(e.target.value)} />
          <input type="email" placeholder="E-mail" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
          <select value={optionId} onChange={e => setOptionId(e.target.value)}>
            <option value="">Massage</option>
            {options.map(o => (
              <option value={o.id} key={o.id}>
                {o.services?.name_fr} · {o.duration_minutes} min · CHF {Number(o.price_chf).toFixed(0)}
              </option>
            ))}
          </select>
          <select value={startAt} onChange={e => setStartAt(e.target.value)}>
            <option value="">Heure</option>
            {timeOptions.map(time => <option key={time} value={time}>{time}</option>)}
          </select>
          <button className="primary" onClick={createManualBooking}>Ajouter</button>
        </div>

        <div>
          <h2>Bloquer du temps</h2>
          <div className="timeRow">
            <select value={blockStart} onChange={e => setBlockStart(e.target.value)}>
              <option value="">Début</option>
              {timeOptions.map(time => <option key={time} value={time}>{time}</option>)}
            </select>
            <select value={blockEnd} onChange={e => setBlockEnd(e.target.value)}>
              <option value="">Fin</option>
              {timeOptions.map(time => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
          <input placeholder="Raison (facultatif)" value={blockReason} onChange={e => setBlockReason(e.target.value)} />
          <button className="primary" onClick={addBlock}>Bloquer</button>

          <div className="blockList">
            {blocks.map(b => (
              <div key={b.id}>
                <span>
                  {new Date(b.starts_at).toLocaleTimeString('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}
                  –
                  {new Date(b.ends_at).toLocaleTimeString('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}
                  {' '}{b.reason || ''}
                </span>
                <button onClick={() => deleteBlock(b.id)}>Supprimer</button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
