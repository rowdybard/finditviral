export const DIGEST_TIME_ZONE = 'America/Detroit'
export const DIGEST_START_HOUR = 8

export interface DetroitSchedule {
  localDate: string
  localHour: number
  shouldAttempt: boolean
}

const detroitScheduleFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

export function getDetroitSchedule(scheduledTime: number): DetroitSchedule {
  if (!Number.isFinite(scheduledTime)) {
    throw new TypeError('scheduledTime must be a finite epoch timestamp')
  }

  const parts = detroitScheduleFormatter.formatToParts(new Date(scheduledTime))
  const values = new Map(parts.map((part) => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  const localHour = Number(values.get('hour'))

  if (!year || !month || !day || !Number.isInteger(localHour)) {
    throw new TypeError('scheduledTime could not be represented in America/Detroit')
  }

  return {
    localDate: `${year}-${month}-${day}`,
    localHour,
    shouldAttempt: localHour >= DIGEST_START_HOUR,
  }
}

