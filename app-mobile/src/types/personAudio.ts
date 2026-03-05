export interface PersonAudioClip {
  id: string
  personId: string
  userId: string
  storagePath: string
  fileName: string
  durationSeconds: number
  sortOrder: number
  createdAt: string
  // Client-side only (not stored in DB):
  localUri?: string
  signedUrl?: string
}

export interface AudioRecordingState {
  isRecording: boolean
  currentDuration: number
  clips: PersonAudioClip[]
}

export const MAX_AUDIO_CLIPS = 5
export const MAX_CLIP_DURATION_SECONDS = 60
