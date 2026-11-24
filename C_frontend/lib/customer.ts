export type Theme = 'light' | 'dark'
export type DashboardView =
  | 'overview'
  | 'requests'
  | 'quotes'
  | 'tracking'
  | 'messages'
  | 'finance'
  | 'addresses'
  | 'vehicles'
  | 'profile'
  | 'garage'

export type CustomerProfile = {
  id: string
  email: string
  name: string
  phone: string | null
  preferredName: string | null
  companyName: string | null
  accountStatus: 'PENDING_VERIFICATION' | 'ACTIVE'
  emailVerified: boolean
}

export type SavedVehicle = {
  id: string
  make: string
  model: string
  year: number | null
  variant: string | null
  registrationNumber: string | null
  chassisVin: string | null
  engineInfo: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type AuthInput = {
  mode: 'signin' | 'create'
  email: string
  password: string
  name?: string
  preferredName?: string
  phone?: string
}
