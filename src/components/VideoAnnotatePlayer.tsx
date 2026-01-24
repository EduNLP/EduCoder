'use client'

import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const WHITE_VIDEO_POSTER =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect width=%2216%22 height=%229%22 fill=%22white%22/%3E%3C/svg%3E'

const formatTimestamp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '--:--'
  const totalSeconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

type VideoAnnotatePlayerProps = {
  src: string
  mimeType?: string
  className?: string
}

export function VideoAnnotatePlayer({
  src,
  mimeType = 'video/mp4',
  className,
}: VideoAnnotatePlayerProps) {
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false)
  const [showVideoControls, setShowVideoControls] = useState(false)
  const [showVideoPlayOverlay, setShowVideoPlayOverlay] = useState(true)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [videoVolume, setVideoVolume] = useState(0.8)
  const [isVideoMuted, setIsVideoMuted] = useState(false)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [playbackTime, setPlaybackTime] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoContainerRef = useRef<HTMLDivElement | null>(null)

  const shouldShowPlayOverlay =
    Boolean(src) && !hasPlayedOnce && showVideoPlayOverlay
  const resolvedDuration =
    typeof videoDuration === 'number' && Number.isFinite(videoDuration)
      ? videoDuration
      : null
  const isSeekEnabled = resolvedDuration !== null && resolvedDuration > 0
  const clampedPlaybackTime =
    resolvedDuration === null ? 0 : Math.min(playbackTime, resolvedDuration)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const handlePointerChange = () => {
      const coarse = mediaQuery.matches
      setIsCoarsePointer(coarse)
      if (!hasPlayedOnce) {
        setShowVideoControls(false)
        return
      }
      if (coarse) {
        setShowVideoControls(true)
      }
    }

    handlePointerChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handlePointerChange)
      return () => mediaQuery.removeEventListener('change', handlePointerChange)
    }
    mediaQuery.addListener(handlePointerChange)
    return () => mediaQuery.removeListener(handlePointerChange)
  }, [hasPlayedOnce])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    const handleTimeUpdate = () => {
      setPlaybackTime(videoElement.currentTime)
    }

    videoElement.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [src])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return
    videoElement.volume = videoVolume
    videoElement.muted = isVideoMuted
  }, [videoVolume, isVideoMuted, src])

  useEffect(() => {
    setHasPlayedOnce(false)
    setShowVideoControls(false)
    setShowVideoPlayOverlay(true)
    setIsVideoPlaying(false)
    setVideoDuration(null)
    setPlaybackTime(0)
  }, [src])

  const handleVideoPlayClick = () => {
    const videoElement = videoRef.current
    if (!videoElement) return
    const playPromise = videoElement.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (!hasPlayedOnce) setShowVideoPlayOverlay(true)
      })
    }
  }

  const handleVideoPlay = () => {
    setHasPlayedOnce(true)
    setShowVideoControls(true)
    setShowVideoPlayOverlay(false)
    setIsVideoPlaying(true)
  }

  const handleVideoLoadedMetadata = () => {
    const duration = videoRef.current?.duration
    if (typeof duration === 'number' && Number.isFinite(duration)) {
      setVideoDuration(duration)
    }
  }

  const handleVideoPause = () => {
    setIsVideoPlaying(false)
    if (!hasPlayedOnce) {
      setShowVideoPlayOverlay(true)
    }
  }

  const handleTogglePlayback = () => {
    const videoElement = videoRef.current
    if (!videoElement) return
    if (videoElement.paused || videoElement.ended) {
      const playPromise = videoElement.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (!hasPlayedOnce) setShowVideoPlayOverlay(true)
        })
      }
      return
    }
    videoElement.pause()
  }

  const handleSeek = (nextTime: number) => {
    const videoElement = videoRef.current
    if (!videoElement || !Number.isFinite(nextTime)) return
    const clamped = Math.min(
      Math.max(nextTime, 0),
      resolvedDuration ?? nextTime,
    )
    videoElement.currentTime = clamped
    setPlaybackTime(clamped)
  }

  const handleVolumeChange = (nextVolume: number) => {
    if (!Number.isFinite(nextVolume)) return
    const clampedVolume = Math.min(1, Math.max(0, nextVolume))
    const videoElement = videoRef.current
    if (videoElement) {
      videoElement.volume = clampedVolume
      videoElement.muted = clampedVolume === 0
    }
    setVideoVolume(clampedVolume)
    setIsVideoMuted(clampedVolume === 0)
  }

  const handleToggleMute = () => {
    const videoElement = videoRef.current
    if (!videoElement) return
    const nextMuted = !isVideoMuted
    videoElement.muted = nextMuted
    setIsVideoMuted(nextMuted)
    if (!nextMuted && videoElement.volume === 0) {
      videoElement.volume = 0.6
      setVideoVolume(0.6)
    }
  }

  return (
    <div
      ref={videoContainerRef}
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white ${
        className ?? ''
      }`}
      onMouseEnter={() => {
        if (!hasPlayedOnce) return
        setShowVideoControls(true)
      }}
      onMouseLeave={() => {
        if (!hasPlayedOnce || isCoarsePointer) return
        setShowVideoControls(false)
      }}
      onFocusCapture={() => {
        if (!hasPlayedOnce) return
        setShowVideoControls(true)
      }}
      onBlurCapture={(event) => {
        if (!hasPlayedOnce || isCoarsePointer) return
        const nextTarget = event.relatedTarget as Node | null
        if (nextTarget && event.currentTarget.contains(nextTarget)) {
          return
        }
        setShowVideoControls(false)
      }}
      onTouchStart={() => {
        if (!hasPlayedOnce) return
        setShowVideoControls(true)
      }}
    >
      <video
        key={src}
        ref={videoRef}
        className="video-annotate-player h-full w-full max-h-[360px] bg-white"
        data-controls-visible={showVideoControls ? 'true' : 'false'}
        controls={false}
        playsInline
        preload="metadata"
        poster={WHITE_VIDEO_POSTER}
        onContextMenu={(event) => event.preventDefault()}
        onClick={handleTogglePlayback}
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onEnded={handleVideoPause}
        onLoadedMetadata={handleVideoLoadedMetadata}
      >
        {src ? <source src={src} type={mimeType} /> : null}
        Your browser does not support the video tag.
      </video>
      {!src && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm shadow-slate-200/70">
            No video uploaded for this transcript.
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={handleVideoPlayClick}
        aria-label="Play video"
        className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/30 text-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.8)] backdrop-blur-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          shouldShowPlayOverlay ? '' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!shouldShowPlayOverlay}
        tabIndex={shouldShowPlayOverlay ? 0 : -1}
      >
        <svg
          width="22"
          height="26"
          viewBox="0 0 22 26"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M5 4.2c0-1.18 1.3-1.9 2.34-1.2l11.2 7a1.5 1.5 0 0 1 0 2.6l-11.2 7c-1.04.66-2.34-.06-2.34-1.26V4.2Z" />
        </svg>
      </button>
      {src && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-4 pb-3 pt-8 text-white transition duration-200 ${
            showVideoControls ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/80 via-slate-950/40 to-transparent" />
          <input
            type="range"
            min={0}
            max={resolvedDuration ?? 0}
            step={0.1}
            value={clampedPlaybackTime}
            onChange={(event) => handleSeek(Number(event.target.value))}
            disabled={!isSeekEnabled}
            className="relative z-10 h-1 w-full cursor-pointer accent-white/90"
            aria-label="Seek within video"
          />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTogglePlayback}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label={isVideoPlaying ? 'Pause video' : 'Play video'}
              >
                {isVideoPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  aria-label={isVideoMuted ? 'Unmute video' : 'Mute video'}
                >
                  {isVideoMuted || videoVolume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={videoVolume}
                  onChange={(event) =>
                    handleVolumeChange(Number(event.target.value))
                  }
                  className="h-1 w-20 cursor-pointer accent-white/90"
                  aria-label="Adjust volume"
                />
              </div>
              <span className="text-xs font-mono text-white/80">
                {formatTimestamp(clampedPlaybackTime)} /{' '}
                {formatTimestamp(videoDuration)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
