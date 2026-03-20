export type GenderOption = 'man' | 'woman' | 'non-binary' | 'transgender' | 'genderqueer' | 'genderfluid' | 'agender' | 'prefer-not-to-say'

export const GENDER_OPTIONS: Array<{ value: GenderOption; label: string }> = [
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'transgender', label: 'Transgender' },
  { value: 'genderqueer', label: 'Genderqueer' },
  { value: 'genderfluid', label: 'Genderfluid' },
  { value: 'agender', label: 'Agender' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
]

export type CardSectionType = 'romantic' | 'adventurous' | 'category'

export interface HolidayCardSection {
  label: string
  type: CardSectionType
  categorySlug?: string
  experienceType?: string
}

export interface HolidayDefinition {
  id: string
  name: string
  getDate: (year: number) => Date
  sections: HolidayCardSection[]
  genderFilter?: GenderOption[]
}
