import { EventEmitter } from 'events'

export interface ServerEvent<TPayload = unknown> {
  id: string
  type: string
  payload: TPayload
  createdAt: string
}

export type ServerEventListener = (event: ServerEvent) => void

const eventBus = new EventEmitter()
const eventHistory: ServerEvent[] = []
const HISTORY_LIMIT = 100
let eventSeq = 0

function nextEventId(): string {
  eventSeq += 1
  return `${Date.now()}-${eventSeq}`
}

export function publishEvent<TPayload>(type: string, payload: TPayload): ServerEvent<TPayload> {
  const event: ServerEvent<TPayload> = {
    id: nextEventId(),
    type,
    payload,
    createdAt: new Date().toISOString()
  }

  eventHistory.push(event)
  if (eventHistory.length > HISTORY_LIMIT) {
    eventHistory.shift()
  }

  eventBus.emit('event', event)
  return event
}

export function subscribeEvents(listener: ServerEventListener): () => void {
  eventBus.on('event', listener)
  return () => {
    eventBus.off('event', listener)
  }
}

export function getEventHistory(afterId?: string): ServerEvent[] {
  if (!afterId) {
    return [...eventHistory]
  }

  const index = eventHistory.findIndex((event) => event.id === afterId)
  if (index === -1) {
    return [...eventHistory]
  }

  return eventHistory.slice(index + 1)
}

export function clearEventHistory(): void {
  eventHistory.length = 0
}
