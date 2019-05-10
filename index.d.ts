import { Writable, Readable } from 'stream'
import { ChildProcess } from 'child_process'

interface VideoStreamMetadata {
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
}

interface AudioStreamMetadata {
  type: string
  codec: string
  samplerate: number
  channels: number
  bitrate: number
}

interface MetadataEventData {
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

interface ProgressEventData {
  frame: number
  fps: number
  quality: number
  size: number
  time: number
  bitrate: number
  progress: number
}

export default class Transcoder {
  constructor(options: { source: string | Readable; ffmpegPath?: string })

  on(type: 'metadata', cb: (data: MetadataEventData) => void): Transcoder
  on(type: 'progress', cb: (data: ProgressEventData) => void): Transcoder
  on(type: 'finish', cb: () => void): Transcoder
  on(type: 'error', cb: (error: Error) => void): Transcoder

  /**
   * Sets the video codec.
   *
   * Notice: Supported video codecs depends on your FFmpeg installation.
   * Running `ffmpeg -codecs` from your terminal will list the supported codecs.
   *
   * @param codec Name of the video codec. As an example `h264`.
   */
  videoCodec(codec: string): Transcoder

  /**
   * Sets the video bitrate.
   *
   * @param bitrate The bitrate of the encoded video. Both `1280000` or `128 kbit` can be passed.
   */
  videoBitrate(bitrate: number | string): Transcoder

  /**
   * Sets the number of frames per second.
   *
   * @param fps Frames per second.
   */
  fps(fps: number): Transcoder

  /**
   * Sets the output format.
   *
   * Notice: Supported formats also depends on you FFmpeg installation.
   * Running `ffmpeg -formats` from your terminal will list the supported formats.
   *
   * @param format Output format.
   */
  format(format: string): Transcoder

  /**
   * Sets the output video size, shrinking to fit the size to maintain aspect ratio.
   * The output video will be within the defined size, but with aspect ratio is preserved.
   *
   * @param width Maximum width of video.
   * @param height Miximum height of video.
   */
  maxSize(width: number, height: number): Transcoder

  /**
   * Sets the output video size, scaling it to have a minimum of both directions, while maintaining aspect ratio.
   *
   * @param width Minimum width of video.
   * @param height Minimum height of video.
   */
  minSize(width: number, height: number): Transcoder

  /**
   * Sets the output video size, not maintaining aspect ratio if it doesn't fit.
   *
   * @param width Minimum width of video.
   * @param height Minimum height of video.
   */
  size(width: number, height: number): Transcoder

  /**
   * Sets the number of encoder passes.
   *
   * @param passes The number of encoder passes.
   */
  passes(passes: number): Transcoder

  /**
   * Sets the video aspect ratio.
   *
   * @param ratio The desired aspect ratio. As an example `1.7777777`.
   */
  aspectRatio(ratio: number): Transcoder

  /**
   * Sets the audio codec.
   *
   * Notice: Supported audio codecs depends on your FFmpeg installation.
   * Running ffmpeg -codecs from your terminal will list the supported codecs.
   *
   * @param codec Name of the audio codec. As an example `mp3` or `aac`.
   */
  audioCodec(codec: string): Transcoder

  /**
   * Sets the audio sample rate.
   *
   * @param rate Audio sample rate. As an example `44100`.
   */
  sampleRate(rate: number): Transcoder

  /**
   * Sets the number of audio channels.
   *
   * @param channels Number of audio channels.
   */
  channels(channels: number): Transcoder

  /**
   * Sets the audio bitrate.
   *
   * @param bitrate The audio bitrate.
   */
  audioBitrate(bitrate: number): Transcoder

  /**
   * Capture a single frame at `ms`. Sets up transcoder to jpeg output.
   *
   * @param ms Time of frame in milliseconds.
   */
  captureFrame(ms: number): Transcoder

  /**
   * Returns a writeable stream that will emit the transcoded media data.
   */
  stream(): Writable

  /**
   * Writes transcoded media data to `filePath`.
   *
   * @param filePath Path of filename.
   */
  writeToFile(filePath: string): Transcoder

  /**
   * Executes the transcoder without outputting any data. This is useful if you only need metadata for a media file.
   */
  exec(): ChildProcess

  /**
   * Adds a custom parameter to the FFmpeg command line.
   * This is for all your special needs that is currently not implemented as a function in the Transcoder.
   *
   * @param key The key for the parameter.
   * @param value The value for the parameter.
   */
  custom(key: string, value?: string): Transcoder

  /**
   * INTERNAL - Returns an array of the arguments that will be used
   */
  _compileArguments(): string[]
}
