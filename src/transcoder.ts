import { EventEmitter } from 'events'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import readline from 'readline'
import os from 'os'
import { Readable, Writable } from 'stream'
import { MetadataEventData, ProgressEventData } from '@/types'

interface Filters {
  [key: string]: {
    match: RegExp
    idx?: number
    transform?: (result: string) => any
  }
}

interface Constructor {
  source: string | Readable
  ffmpegPath?: string
}

/*
	Transcodes a media stream from one format to another.
	 @source A file or a readable stream.

	Events:
	 'metadata' emitted when media metadata is available.
	  @metadata (callback parameter) The media mediadata.

	 'progress' emitted when transcoding has progressed.
	  @progress (callback parameter) The status of the transcoding process.

	 'finish' emitted when transcoding has completed.

	 'error' emmited if an error occurs.
	  @error (callback parameter) The error that occured.
*/

export default class Transcoder extends EventEmitter {
  stdin = new Writable()

  source: string | Readable
  ffmpegPath: string

  args: { [key: string]: string | string[] } = {}
  lastErrorLine: string | null = null

  constructor({ source, ffmpegPath }: Constructor) {
    super()

    this.source = source
    this.ffmpegPath = ffmpegPath || process.env.FFMPEG_BIN_PATH || 'ffmpeg'
  }

  /** Spawns child and sets up piping */
  _exec(args: string[]) {
    if (typeof this.source === 'string') {
      args = ['-i', this.source].concat(args)
    } else {
      args = ['-i', '-'].concat(args)
    }

    console.log('Spawning ffmpeg ' + args.join(' '))

    const child = spawn(this.ffmpegPath, args, {
      cwd: os.tmpdir(),
    })

    this._parseMetadata(child)

    child.stdin.on('error', () => {
      try {
        if ('object' == typeof this.source) this.source.unpipe(this.stdin)
      } catch (e) {
        // Do nothing
      }
    })

    child.on('exit', code => {
      if (!code) {
        this.emit('finish')
      } else {
        this.emit('error', new Error('FFmpeg error: ' + this.lastErrorLine))
      }
    })

    if (typeof this.source === 'object') this.source.pipe(child.stdin)

    return child
  }

  /** Compile arguments for FFmpeg */
  _compileArguments() {
    let args: string[] = []
    for (let key in this.args) args = args.concat(this.args[key])
    return args
  }

  _parseMetadata(child: ChildProcessWithoutNullStreams) {
    /** Converts a FFmpeg time format to milliseconds */
    const _parseDuration = (duration: string) => {
      const d = duration.split(/[:.]/)
      return (
        parseInt(d[0]) * 60 * 60 * 1000 +
        parseInt(d[1]) * 60 * 1000 +
        parseInt(d[2]) * 1000 +
        parseInt(d[3])
      )
    }

    const metadataFilters: Filters = {
      type: {
        match: /Stream #[0-9]+:[0-9]+.*?: (\w+):/i,
        transform: r => {
          if (r[1]) return r[1].toLowerCase()
        },
      },
      codec: {
        match: /Stream.*?:.*?: \w+: (.*?)(?: |\()/i,
        idx: 1,
      },
      samplerate: {
        match: /(\d+) Hz/i,
        idx: 1,
        transform: parseInt,
      },
      channels: {
        match: /\d+ Hz, (.*?)(?:,|$)/i,
        idx: 1,
        transform: r => {
          if (r === 'mono') return 1
          if (r === 'stereo') return 2
          else return parseInt(r)
        },
      },
      bitrate: {
        match: /(\d+) (\w)?b\/s/i,
        transform: r => {
          if (r[2] === 'k') return parseInt(r[1]) * 1000
          if (r[2] === 'm') return parseInt(r[1]) * 1000 * 1000
          return parseInt(r[1])
        },
      },
      fps: {
        match: /(\d+) fps/i,
        idx: 1,
        transform: parseInt,
      },
      size: {
        match: /(\d+)x(\d+)(?: \[.*?\])?(?:,|$)/i,
        transform: r => {
          if (r[1] && r[2])
            return { width: parseInt(r[1]), height: parseInt(r[2]) }
        },
      },
      aspect: {
        match: /(\d+)x(\d+)(?: \[.*?\])?(?:,|$)/i,
        transform: r => {
          if (r[1] && r[2]) return parseInt(r[1]) / parseInt(r[2])
        },
      },
      colors: {
        match: /Video:.*?, (.*?)(?:,|$)/i,
        idx: 1,
      },
    }

    /* Filters for parsing progress */
    const progressFilters: Filters = {
      frame: {
        match: /frame= .?([\d]+)/i,
        idx: 1,
        transform: parseInt,
      },
      fps: {
        match: /fps=([\d.]+)/i,
        idx: 1,
        transform: parseInt,
      },
      quality: {
        match: /q=([\d.]+)/i,
        idx: 1,
        transform: parseInt,
      },
      size: {
        match: /size=[\s]+?([\d]+)(\w)?b/i,
        transform: r => {
          if (r[2] === 'k') return parseInt(r[1]) * 1024
          if (r[2] === 'm') return parseInt(r[1]) * 1024 * 1024
          return parseInt(r[1])
        },
      },
      time: {
        match: /time=(\d+:\d+:\d+.\d+)/i,
        idx: 1,
        transform: _parseDuration,
      },
      bitrate: {
        match: /bitrate=[\s]+?([\d.]+)(\w)?bits\/s/i,
        transform: r => {
          if (r[2] === 'k') return parseInt(r[1]) * 1000
          if (r[2] === 'm') return parseInt(r[1]) * 1000 * 1000
          return parseInt(r[1])
        },
      },
    }

    /** Applies a set of filters to some data and returns the result */
    const _applyFilters = (data: string, filters: Filters) => {
      const ret: Transcoder['args'] = {}

      for (let key in filters) {
        const filter = filters[key]
        const match: RegExpMatchArray = filter.match.exec(data) || []
        let result: string | null = null

        if (filter.idx) {
          result = match[filter.idx]
        }

        const v = filter.transform ? filter.transform(result as any) : result

        if (v) {
          ret[key] = v
        }
      }

      return ret
    }

    const metadata: MetadataEventData = { input: {}, output: {} } as any
    let current: any

    const metadataLines = readline.createInterface({
      input: child.stderr,
      output: process.stdout,
      terminal: false,
    })

    let ended = false
    const _endParse = () => {
      if (!ended) this.emit('metadata', metadata)
      ended = true
    }

    child.on('exit', _endParse)

    metadataLines.on('line', newLine => {
      /* Process metadata */
      const line = newLine.replace(/^\s+|\s+$/g, '')

      try {
        if (!ended) {
          if (line.length > 0) this.lastErrorLine = line

          if (/^input/i.test(line)) {
            current = metadata.input = { streams: [] } as any
          } else if (/^output/i.test(line)) {
            current = metadata.output = { streams: [] }
          } else if (/^Metadata:$/i.test(line)) {
            if (current.streams && current.streams.length) {
              current.streams[current.streams.length - 1].metadata = {}
            } else {
              current.metadata = {} as any
            }
          } else if (/^duration/i.test(line)) {
            const d = /duration: (\d+:\d+:\d+.\d+)/i.exec(line)!
            current.duration = _parseDuration(d[1])
            current.synched = /start: 0.000000/.exec(line) != null
          } else if (/^stream mapping/i.test(line)) {
            _endParse()
          } else if (/^stream #/i.test(line)) {
            current.streams.push(_applyFilters(line, metadataFilters))
          } else {
            let metadataTarget
            if (
              current.streams.length &&
              current.streams[current.streams.length - 1].metadata
            ) {
              metadataTarget =
                current.streams[current.streams.length - 1].metadata
            } else if (current.metadata) {
              metadataTarget = current.metadata
            }

            if (metadataTarget) {
              const metadataInfo = line.match(/^(\S+?)\s*:\s*(.+?)$/)
              if (metadataInfo && metadataInfo.length) {
                metadataTarget[metadataInfo[1]] = metadataInfo[2]
              }
            }
          }
        }

        /* Track progress */
        if (/^(frame|size)=/i.test(line)) {
          if (!ended) _endParse()
          const progress: ProgressEventData = _applyFilters(
            line,
            progressFilters,
          ) as any

          if (metadata.input.duration) {
            progress.progress = progress.time / metadata.input.duration
          }

          this.emit('progress', progress)
        }
      } catch (e) {
        this.emit('parseError', line)
      }
    })
  }

  /**
   * Sets the video bitrate.
   *
   * @param bitrate The bitrate of the encoded video. Both `1280000` or `128 kbit` can be passed.
   */
  videoBitrate(bitrate: number) {
    this.args['b'] = ['-b:v', bitrate.toString()]
    return this
  }

  /**
   * Sets the video codec.
   *
   * Notice: Supported video codecs depends on your FFmpeg installation.
   * Running `ffmpeg -codecs` from your terminal will list the supported codecs.
   *
   * @param codec Name of the video codec. As an example `h264`.
   */
  videoCodec(codec: string) {
    this.args['vcodec'] = ['-vcodec', codec]
    return this
  }

  /**
   * Sets the number of frames per second.
   *
   * @param fps Frames per second.
   */
  fps(fps: number) {
    this.args['r'] = ['-r', fps.toString()]
    return this
  }

  /**
   * Sets the output format.
   *
   * Notice: Supported formats also depends on you FFmpeg installation.
   * Running `ffmpeg -formats` from your terminal will list the supported formats.
   *
   * @param format Output format.
   */
  format(format: string) {
    this.args['format'] = ['-f', format]

    if (format.toLowerCase() === 'mp4') {
      this.args['movflags'] = ['-movflags', 'frag_keyframe+faststart']
    }

    return this
  }

  /**
   * Sets the output video size, shrinking to fit the size to maintain aspect ratio.
   * The output video will be within the defined size, but with aspect ratio is preserved.
   *
   * @param width Maximum width of video.
   * @param height Miximum height of video.
   */
  maxSize(width: number, height: number, alwaysScale?: boolean) {
    if (alwaysScale === undefined) alwaysScale = true

    let fltWdth =
      'min(trunc(' + width + '/hsub)*hsub\\,trunc(a*' + height + '/hsub)*hsub)'

    let fltHght =
      'min(trunc(' + height + '/vsub)*vsub\\,trunc(' + width + '/a/vsub)*vsub)'

    if (!alwaysScale) {
      fltWdth = 'min(trunc(iw/hsub)*hsub\\,' + fltWdth + ')'
      fltHght = 'min(trunc(ih/vsub)*vsub\\,' + fltHght + ')'
    }

    this.args['vfscale'] = ['-vf', 'scale=' + fltWdth + ':' + fltHght]

    return this
  }

  /**
   * Sets the output video size, scaling it to have a minimum of both directions, while maintaining aspect ratio.
   *
   * @param width Minimum width of video.
   * @param height Minimum height of video.
   */
  minSize(width: number, height: number, alwaysScale?: boolean) {
    if (alwaysScale === undefined) alwaysScale = true

    let fltWdth =
      'max(trunc(' + width + '/hsub)*hsub\\,trunc(a*' + height + '/hsub)*hsub)'

    let fltHght =
      'max(trunc(' + height + '/vsub)*vsub\\,trunc(' + width + '/a/vsub)*vsub)'

    if (!alwaysScale) {
      fltWdth = 'max(trunc(iw/hsub)*hsub)\\,' + fltWdth + ')'
      fltHght = 'max(trunc(ih/vsub)*vsub)\\,' + fltHght + ')'
    }

    this.args['vfscale'] = ['-vf', 'scale=' + fltWdth + ':' + fltHght]

    return this
  }

  /**
   * Sets the output video size, not maintaining aspect ratio if it doesn't fit.
   *
   * @param width Minimum width of video.
   * @param height Minimum height of video.
   */
  size(width: number, height: number) {
    this.args['s'] = ['-s', width + 'x' + height]
    return this
  }

  /**
   * Sets the number of encoder passes.
   *
   * @param passes The number of encoder passes.
   */
  passes(passes: number) {
    this.args['pass'] = ['-pass', passes.toString()]
    return this
  }

  /**
   * Sets the video aspect ratio.
   *
   * @param ratio The desired aspect ratio. As an example `1.7777777`.
   */
  aspectRatio(ratio: number) {
    this.args['aspect'] = ['-aspect', ratio.toString()]
    return this
  }

  /**
   * Sets the audio codec.
   *
   * Notice: Supported audio codecs depends on your FFmpeg installation.
   * Running ffmpeg -codecs from your terminal will list the supported codecs.
   *
   * @param codec Name of the audio codec. As an example `mp3` or `aac`.
   */
  audioCodec(codec: string) {
    this.args['acodec'] = ['-acodec', codec]
    return this
  }

  /**
   * Sets the audio sample rate.
   *
   * @param rate Audio sample rate. As an example `44100`.
   */
  sampleRate(rate: number) {
    this.args['ar'] = ['-ar', rate.toString()]
    return this
  }

  /**
   * Sets the number of audio channels.
   *
   * @param channels Number of audio channels.
   */
  channels(channels: number) {
    this.args['ac'] = ['-ac', channels.toString()]
    return this
  }

  /**
   * Sets the audio bitrate.
   *
   * @param bitrate The audio bitrate.
   */
  audioBitrate(bitrate: number) {
    this.args['ab'] = ['-ab', bitrate.toString()]
    return this
  }

  /**
   * Capture a single frame at `ms`. Sets up transcoder to jpeg output.
   *
   * @param ms Time of frame in milliseconds.
   */
  captureFrame(ms: number) {
    const secs = ms / 1000

    let hours = Math.floor(secs / (60 * 60))
    const minuteDivisor = secs % (60 * 60)
    let minutes = Math.floor(minuteDivisor / 60)

    const secondDivisor = minuteDivisor % 60
    let seconds = secondDivisor

    while (seconds >= 60) {
      seconds -= 60
      minutes++
    }

    while (minutes >= 60) {
      minutes -= 60
      hours++
    }

    const timestamp =
      hours.toString() + ':' + minutes.toString() + ':' + seconds.toString()

    this.args['ss'] = [
      '-ss',
      timestamp,
      '-an',
      '-r',
      '1',
      '-vframes',
      '1',
      '-y',
    ]

    return this.videoCodec('mjpeg').format('mjpeg')
  }

  /**
   * Adds a custom parameter to the FFmpeg command line.
   * This is for all your special needs that is currently not implemented as a function in the Transcoder.
   *
   * @param key The key for the parameter.
   * @param value The value for the parameter.
   */
  custom(key: string, value?: string) {
    const args = ['-' + key]

    if (value !== undefined) {
      args.push(value)
    }

    this.args[key] = args

    return this
  }

  /**
   * Executes the transcoder without outputting any data. This is useful if you only need metadata for a media file.
   */
  exec() {
    return this._exec(this._compileArguments())
  }

  /**
   * Returns a writeable stream that will emit the transcoded media data.
   */
  stream() {
    const a = this._compileArguments()
    a.push('pipe:1')

    return this._exec(a).stdout
  }

  /**
   * Writes transcoded media data to `filePath`.
   *
   * @param filePath Path of filename.
   */
  writeToFile(filePath: string) {
    let a = this._compileArguments()
    a = a.concat('-y', filePath)

    this._exec(a)
    return this
  }
}

/*
  on(type: 'metadata', cb: (data: MetadataEventData) => void): this
  on(type: 'progress', cb: (data: ProgressEventData) => void): this
  on(type: 'finish', cb: () => void): this
  on(type: 'error', cb: (error: Error) => void): this
 */
