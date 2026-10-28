export type BillingPeriod = 'month' | 'year'
export type BillingPrice = { available: boolean; amountMinor?: number; currency?: string }
export type TeacherBilling = {
  plan: 'free' | 'pro'
  manualPlan?: 'free' | 'pro' | null
  status: string
  currentPeriod: BillingPeriod | null
  paidThrough: string | null
  cancelAtPeriodEnd: boolean
  mode: 'test' | 'live' | 'unconfigured'
  checkoutAvailable: boolean
  portalAvailable: boolean
  cancellationAvailable?: boolean
  prices: Record<BillingPeriod, BillingPrice>
  limits: { groups: number; activeAssignments: number; aiCredits: number }
  usage: { groups: number; activeAssignments: number; aiCredits: number }
  plans?: {
    free: { groups: number; activeAssignments: number; aiCredits: number }
    pro: { groups: number; activeAssignments: number; aiCredits: number }
  }
}

export type AdminTeacherPlan = {
  userId: number
  plan: 'free' | 'pro'
  manualPlan?: 'free' | 'pro' | null
  status: string
  period: BillingPeriod | null
  amountMinor: number | null
  currency: string | null
  paidThrough: string | null
  cancelAtPeriodEnd: boolean
  limits?: TeacherBilling['limits']
  usage?: TeacherBilling['usage']
  reservedAiCredits?: number
}

export type TeacherPayment = {
  invoiceId: string
  userId: number
  status: 'paid' | 'failed'
  billingPeriod: BillingPeriod
  amountDue: number
  amountPaid: number
  currency: string
  paymentAt: string
  periodStart: string | null
  periodEnd: string | null
}
