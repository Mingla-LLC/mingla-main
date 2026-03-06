import { supabase } from './supabase'
import { extractFunctionError } from '../utils/edgeFunctionError'

export interface ProcessPersonAudioParams {
  personId: string
  audioStoragePath: string
  location: { latitude: number; longitude: number }
  occasions: Array<{ name: string; date: string }>
}

export interface ProcessPersonAudioResult {
  personId: string
  transcription: string
  extractedInterests: string[]
  description: string
  experiencesGenerated: boolean
}

export async function processPersonAudio(
  params: ProcessPersonAudioParams
): Promise<ProcessPersonAudioResult> {
  const { data, error } = await supabase.functions.invoke('process-person-audio', {
    body: params,
  })

  if (error) {
    const parsed = await extractFunctionError(error, 'Audio processing failed')
    throw new Error(parsed)
  }

  return data as ProcessPersonAudioResult
}
