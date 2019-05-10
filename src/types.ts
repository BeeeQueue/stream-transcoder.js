export interface VideoStreamMetadata {
  type: string
  codec: string
  bitrate: number
  fps: number
  size: {
    width: number
    height: number
  }
  aspect: number
  colors: string
  metadata?: unknown
}

export interface AudioStreamMetadata {
  type: string
  codec: string
  samplerate: number
  channels: number
  bitrate: number
  metadata?: unknown
}

export interface MetadataEventData {
  input: {
    streams: Array<VideoStreamMetadata | AudioStreamMetadata>
    metadata: {
      encoder: string
      creation_time: string
    }
    duration: number
    synched: boolean
  }
  output: {
    streams?: Array<VideoStreamMetadata | AudioStreamMetadata>
  }
}

export interface ProgressEventData {
  frame: number
  fps: number
  quality: number
  size: number
  time: number
  bitrate: number
  progress: number
}
