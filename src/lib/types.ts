export const MARKETS = ['UK', 'NL', 'EU', 'Global'] as const
export type Market = (typeof MARKETS)[number]

export const FITS = ['Strong', 'Good', 'Stretch'] as const
export type Fit = (typeof FITS)[number]

export const STATUSES = ['Shortlist', 'Applied', 'Interviewing', 'Offer', 'Won', 'Rejected', 'Closed', 'Parked'] as const
export type Status = (typeof STATUSES)[number]
export const ACTIVE_STATUSES: readonly Status[] = ['Shortlist', 'Applied', 'Interviewing', 'Offer']

export const CV_VERSIONS = ['', 'A', 'B'] as const
export type CvVersion = (typeof CV_VERSIONS)[number]

export const CONTRACT_END = '2026-10-31'

export interface Role {
  id: string
  title: string
  org: string
  market: Market
  location: string
  remote: string
  rate: string
  ir35: string
  duration: string
  posted: string | null
  deadline: string | null
  nextDate: string | null
  fit: Fit
  status: Status
  why: string
  caveat: string
  url: string
  contact: string
  nextStep: string
  notes: string
  cv: CvVersion
  jobDescription: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
}
