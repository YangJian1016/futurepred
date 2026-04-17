import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import './App.css'

type PredictResponse = {
  prediction_id: string
  participant_class: string
  participant_name: string
  profession: string
  profession_index: number
  total_professions: number
  status_text: string
  image_prompt: string
  generated_image_url: string
  captured_image_url?: string
  image_provider?: string
}

type LoginResponse = {
  access_token: string
  token_type: string
  expires_in: number
}

type ReviewItem = {
  predictionId: string
  participantClass?: string
  name: string
  profession: string
  imageUrl: string
  capturedImageUrl?: string
}

type HistoryItemResponse = {
  prediction_id: string
  participant_class: string
  participant_name: string
  profession: string
  generated_image_url: string
  captured_image_url?: string
  image_provider: string
  created_at: string
}

type HistoryListResponse = {
  items: HistoryItemResponse[]
  count: number
}

type FaceAttributesGender = {
  label?: string
}

type FaceAttributesFace = {
  gender?: FaceAttributesGender
}

type FaceAttributesResponse = {
  faces?: FaceAttributesFace[]
}

type CameraFacing = 'user' | 'environment'

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const normalizeReviewItem = (value: unknown): ReviewItem | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const raw = value as Record<string, unknown>
  const predictionId = asString(raw.predictionId) || asString(raw.prediction_id)
  const name = asString(raw.name) || asString(raw.participant_name)
  const profession = asString(raw.profession)
  const imageUrl = asString(raw.imageUrl) || asString(raw.generated_image_url)
  const participantClass = asString(raw.participantClass) || asString(raw.participant_class)
  const capturedImageUrl = asString(raw.capturedImageUrl) || asString(raw.captured_image_url)

  if (!predictionId || !name || !profession || !imageUrl) {
    return null
  }

  return {
    predictionId,
    participantClass: participantClass || undefined,
    name,
    profession,
    imageUrl,
    capturedImageUrl: capturedImageUrl || undefined,
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const REVIEW_STORAGE_KEY = 'futurepred-review-wall'
const AUTH_STORAGE_KEY = 'futurepred-access-token'
const CLASS_PATTERN = /^[0-9]0[0-9]$/
const NAME_PATTERN = /^[A-Za-z\u4e00-\u9fff]+(?: [A-Za-z\u4e00-\u9fff]+)*$/
const WALL_TARGET_TOTAL = 28
const FUTURE_YEARS = Array.from({ length: 15 }, (_, index) => 2026 + index)
const RETURN_YEARS = Array.from({ length: 14 }, (_, index) => 2039 - index)
const LOADING_STORY = [
  '艾小语正在获取你的照片',
  '艾小语正在拿着你的照片去寻找未来的你',
  ...FUTURE_YEARS.map((year) => `${year}年`),
  '艾小语正在寻找2040年的你',
  '艾小语已经找到你了',
  '艾小语正在偷偷拍你的照片',
  '艾小语正在返回现在',
  ...RETURN_YEARS.map((year) => `${year}年`),
  '艾小语已经带着你未来的照片回来了',
]
const TUNNEL_TARGET_TOTAL_MS = 14_000
const TUNNEL_REVEAL_DELAY_MS = 420
const TUNNEL_STEP_MS = Math.max(
  320,
  Math.round((TUNNEL_TARGET_TOTAL_MS - TUNNEL_REVEAL_DELAY_MS) / Math.max(1, LOADING_STORY.length - 1)),
)
const MAIN_RECENT_LIMIT = 20
const MAX_CAPTURE_BYTES = 7 * 1024 * 1024
const CAPTURE_SIZE_STEPS = [720, 640, 560, 480, 400]
const CAPTURE_QUALITY_STEPS = [0.9, 0.84, 0.78, 0.72, 0.66, 0.6]

const loadStoredToken = () => {
  if (typeof window === 'undefined') {
    return ''
  }
  return localStorage.getItem(AUTH_STORAGE_KEY) || ''
}

const loadStoredReviewList = (): ReviewItem[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const cache = localStorage.getItem(REVIEW_STORAGE_KEY)
    if (!cache) {
      return []
    }
    const parsed = JSON.parse(cache) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => normalizeReviewItem(item))
      .filter((item): item is ReviewItem => item !== null)
  } catch {
    return []
  }
}

const getDataUrlBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  if (!base64) {
    return 0
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

const captureCompressedPhoto = (video: HTMLVideoElement) => {
  const sourceWidth = video.videoWidth || 720
  const sourceHeight = video.videoHeight || 720
  const sourceSize = Math.min(sourceWidth, sourceHeight)
  const sourceX = Math.max(0, Math.floor((sourceWidth - sourceSize) / 2))
  const sourceY = Math.max(0, Math.floor((sourceHeight - sourceSize) / 2))

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  let bestDataUrl = ''
  let bestBytes = Number.MAX_SAFE_INTEGER

  for (const size of CAPTURE_SIZE_STEPS) {
    canvas.width = size
    canvas.height = size
    context.clearRect(0, 0, size, size)
    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)

    for (const quality of CAPTURE_QUALITY_STEPS) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const bytes = getDataUrlBytes(dataUrl)
      if (bytes < bestBytes) {
        bestDataUrl = dataUrl
        bestBytes = bytes
      }
      if (bytes <= MAX_CAPTURE_BYTES) {
        return { dataUrl, bytes }
      }
    }
  }

  if (!bestDataUrl) {
    return null
  }

  return { dataUrl: bestDataUrl, bytes: bestBytes }
}

const getCameraErrorMessage = (error: unknown) => {
  if (!(error instanceof DOMException)) {
    return '无法访问摄像头，请改用 Chrome 打开 http://127.0.0.1:5173 并检查权限。'
  }

  if (error.name === 'NotAllowedError') {
    return '摄像头权限被拒绝，请在浏览器地址栏开启摄像头权限后重试。'
  }
  if (error.name === 'NotFoundError') {
    return '未检测到可用摄像头，请确认设备已连接。'
  }
  if (error.name === 'NotReadableError') {
    return '摄像头可能被其他程序占用，请关闭微信/会议软件后重试。'
  }
  if (error.name === 'OverconstrainedError') {
    return '当前摄像头不支持该分辨率，已自动降级，请重试。'
  }
  if (error.name === 'SecurityError') {
    return '当前页面不允许访问摄像头，请使用 http://127.0.0.1:5173 打开。'
  }
  return `摄像头启动失败：${error.name}`
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wallScrollRef = useRef<HTMLDivElement | null>(null)
  const bgmContextRef = useRef<AudioContext | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([])
  const audioLfoRef = useRef<number | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [participantClass, setParticipantClass] = useState('')
  const [capturedImage, setCapturedImage] = useState('')
  const [result, setResult] = useState<PredictResponse | null>(null)
  const [status, setStatus] = useState('点击“开启摄像头”开始')
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isPredicting, setIsPredicting] = useState(false)
  const [error, setError] = useState('')
  const [pendingResult, setPendingResult] = useState<PredictResponse | null>(null)
  const [pendingReviewItem, setPendingReviewItem] = useState<ReviewItem | null>(null)
  const [reviewList, setReviewList] = useState<ReviewItem[]>([])
  const [recentReviewList, setRecentReviewList] = useState<ReviewItem[]>([])
  const [token, setToken] = useState(() => loadStoredToken())
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [loadingStoryIndex, setLoadingStoryIndex] = useState(0)
  const [isWarpSoundEnabled, setIsWarpSoundEnabled] = useState(true)
  const [adminNameFilter, setAdminNameFilter] = useState('')
  const [adminProfessionFilter, setAdminProfessionFilter] = useState('')
  const [isAdminWorking, setIsAdminWorking] = useState(false)
  const [selectedPredictionIds, setSelectedPredictionIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'main' | 'admin' | 'wall'>('main')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmGender, setConfirmGender] = useState<'female' | 'male' | ''>('')
  const [isPreparingConfirm, setIsPreparingConfirm] = useState(false)
  const [isStartingCamera, setIsStartingCamera] = useState(false)
  const [mainWallPageSize, setMainWallPageSize] = useState(5)
  const [mainWallPage, setMainWallPage] = useState(1)
  const [wallFocusMode, setWallFocusMode] = useState(false)
  const [wallAutoScroll, setWallAutoScroll] = useState(false)
  const [isExportingWall, setIsExportingWall] = useState(false)
  const [isExportingAllImages, setIsExportingAllImages] = useState(false)
  const [isExportingDualImages, setIsExportingDualImages] = useState(false)
  const [slideshowMode, setSlideshowMode] = useState(false)
  const [slideshowIndex, setSlideshowIndex] = useState(0)
  const [slideshowMusicOn, setSlideshowMusicOn] = useState(true)
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user')
  const [availableCameraCount, setAvailableCameraCount] = useState(0)

  const trimmedParticipantClass = participantClass.trim()
  const isClassValid = CLASS_PATTERN.test(trimmedParticipantClass)
  const trimmedParticipantName = participantName.trim()
  const isNameValid = NAME_PATTERN.test(trimmedParticipantName)
  const mainWallTotalPages = Math.max(1, Math.ceil(recentReviewList.length / mainWallPageSize))
  const mainWallStart = (mainWallPage - 1) * mainWallPageSize
  const mainWallItems = recentReviewList.slice(mainWallStart, mainWallStart + mainWallPageSize)
  const canSubmitConfirmed = !!confirmGender && !!trimmedParticipantClass && isClassValid && !!trimmedParticipantName && isNameValid
  const normalizedNameFilter = adminNameFilter.trim().toLowerCase()
  const normalizedProfessionFilter = adminProfessionFilter.trim().toLowerCase()
  const adminFilteredList = reviewList.filter((item) => {
    const safeName = asString(item.name).toLowerCase()
    const safeProfession = asString(item.profession).toLowerCase()
    const matchName = !normalizedNameFilter || safeName.includes(normalizedNameFilter)
    const matchProfession = !normalizedProfessionFilter || safeProfession.includes(normalizedProfessionFilter)
    return matchName && matchProfession
  })
  const selectedIdSet = new Set(selectedPredictionIds)
  const selectedInFilteredCount = adminFilteredList.filter((item) => selectedIdSet.has(item.predictionId)).length
  const displayErrorMessage = error.trim().toLowerCase() === 'not found'
    ? '接口未找到，请确认后端服务已启动且 API 地址配置正确。'
    : error

  useEffect(() => {
    const applyHashView = () => {
      if (window.location.hash === '#/admin') {
        setViewMode('admin')
        return
      }
      if (window.location.hash === '#/wall') {
        setViewMode('wall')
        return
      }
      setViewMode('main')
    }

    applyHashView()
    window.addEventListener('hashchange', applyHashView)
    return () => window.removeEventListener('hashchange', applyHashView)
  }, [])

  useEffect(() => {
    if (mainWallPage > mainWallTotalPages) {
      setMainWallPage(mainWallTotalPages)
    }
  }, [mainWallPage, mainWallTotalPages])

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return
    }

    const refreshAvailableCameraCount = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setAvailableCameraCount(devices.filter((device) => device.kind === 'videoinput').length)
      } catch {
        setAvailableCameraCount(0)
      }
    }

    void refreshAvailableCameraCount()
    navigator.mediaDevices.addEventListener?.('devicechange', refreshAvailableCameraCount)

    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshAvailableCameraCount)
    }
  }, [])

  useEffect(() => {
    if (token) {
      localStorage.setItem(AUTH_STORAGE_KEY, token)
      return
    }
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }, [token])

  const loadHistory = async (accessToken: string) => {
    const response = await fetch(`${API_BASE}/api/admin/history`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data: HistoryListResponse | { detail?: string } = await response.json()
    if (response.status === 401) {
      setToken('')
      throw new Error('登录已失效，请重新登录。')
    }
    if (!response.ok || !('items' in data)) {
      throw new Error((data as { detail?: string }).detail ?? '加载历史照片失败')
    }

    const mapped = data.items.map((item) => ({
      predictionId: item.prediction_id,
      participantClass: item.participant_class,
      name: item.participant_name,
      profession: item.profession,
      imageUrl: item.generated_image_url,
      capturedImageUrl: item.captured_image_url,
    }))
    setReviewList(mapped)
    setSelectedPredictionIds([])
  }

  useEffect(() => {
    if (!token) {
      setReviewList([])
      setIsHistoryLoading(false)
      return
    }

    if (viewMode === 'main') {
      setIsHistoryLoading(false)
      return
    }

    let cancelled = false
    setIsHistoryLoading(true)

    const cachedReviewList = loadStoredReviewList()
    if (cachedReviewList.length > 0) {
      setReviewList(cachedReviewList)
    }

    loadHistory(token).catch((historyError) => {
      if (cancelled) {
        return
      }
      setError(historyError instanceof Error ? historyError.message : '历史记录加载失败')
    }).finally(() => {
      if (cancelled) {
        return
      }
      setIsHistoryLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [token, viewMode])

  useEffect(() => {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviewList))
  }, [reviewList])

  useEffect(() => {
    if (reviewList.length >= WALL_TARGET_TOTAL) {
      setWallFocusMode(true)
      setWallAutoScroll(true)
    }
  }, [reviewList.length])

  useEffect(() => {
    if (!wallFocusMode) {
      document.body.style.overflow = ''
      return
    }
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [wallFocusMode])

  useEffect(() => {
    if (!slideshowMode || reviewList.length === 0) {
      return
    }
    const timer = window.setInterval(() => {
      setSlideshowIndex((prev) => (prev + 1) % reviewList.length)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [slideshowMode, reviewList.length])

  const stopSlideshowBgm = () => {
    bgmContextRef.current?.close().catch(() => {})
    bgmContextRef.current = null
  }

  const startSlideshowBgm = async () => {
    stopSlideshowBgm()
    try {
      const ctx = new AudioContext()
      bgmContextRef.current = ctx
      if (ctx.state !== 'running') await ctx.resume()

      const master = ctx.createGain()
      master.gain.value = 0.15
      master.connect(ctx.destination)

      const tone = (freq: number, t: number, dur: number, vol: number, type: OscillatorType) => {
        if (freq <= 0) return
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = type
        osc.frequency.value = freq
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(vol, t + Math.min(0.06, dur * 0.15))
        g.gain.setValueAtTime(vol * 0.85, t + dur * 0.65)
        g.gain.linearRampToValueAtTime(0.0001, t + dur)
        osc.connect(g)
        g.connect(master)
        osc.start(t)
        osc.stop(t + dur + 0.02)
      }

      // Uplifting 4-bar loop in C major (80 BPM, beat = 0.75s)
      // Melody: bright, pentatonic-ish, child-friendly
      const BPM = 80
      const beat = 60 / BPM
      const melodyHz: number[] = [
        523.25, 659.26, 783.99, 659.26,   // Bar 1 (C): C5 E5 G5 E5
        587.33, 698.46, 880.00, 698.46,   // Bar 2 (F): D5 F5 A5 F5
        659.26, 783.99, 880.00, 1046.50,  // Bar 3 (Am): E5 G5 A5 C6 (build)
        783.99, 0,      659.26, 523.25,   // Bar 4 (G): G5 – E5 C5 (resolve)
      ]
      const chordHz: number[][] = [
        [130.81, 196.00, 261.63],  // C3 G3 C4
        [174.61, 220.00, 261.63],  // F3 A3 C4
        [110.00, 164.81, 261.63],  // A2 E3 C4
        [98.00,  196.00, 246.94],  // G2 G3 B3
      ]
      const loopDuration = beat * 16  // 12 s per 4-bar loop
      const LOOPS = 30               // 360 s ≈ 6 min, covers any slideshow

      for (let lp = 0; lp < LOOPS; lp++) {
        const loopT = ctx.currentTime + 0.12 + lp * loopDuration
        // Chord pads (sine — warm and full)
        chordHz.forEach((freqs, b) => {
          const barT = loopT + b * beat * 4
          freqs.forEach((f) => tone(f, barT, beat * 4 * 0.92, 0.042, 'sine'))
        })
        // Melody (triangle — flute-like warmth)
        melodyHz.forEach((freq, i) => {
          tone(freq, loopT + i * beat, beat * 0.80, 0.10, 'triangle')
        })
      }
    } catch {
      // Audio unavailable or blocked — silently skip
    }
  }

  useEffect(() => {
    if (slideshowMode && slideshowMusicOn) {
      void startSlideshowBgm()
    } else {
      stopSlideshowBgm()
    }
  }, [slideshowMode, slideshowMusicOn])

  useEffect(() => {
    if (!wallFocusMode || !wallAutoScroll) {
      return
    }

    const container = wallScrollRef.current
    if (!container) {
      return
    }

    const timer = window.setInterval(() => {
      if (container.scrollHeight <= container.clientHeight) {
        return
      }
      const maxScroll = container.scrollHeight - container.clientHeight
      if (container.scrollTop >= maxScroll - 1) {
        container.scrollTop = 0
        return
      }
      container.scrollTop += 1
    }, 35)

    return () => window.clearInterval(timer)
  }, [wallFocusMode, wallAutoScroll, reviewList.length])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioLfoRef.current) {
        window.clearInterval(audioLfoRef.current)
        audioLfoRef.current = null
      }
      audioNodesRef.current.forEach(({ osc }) => osc.stop())
      audioNodesRef.current = []
      audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])

  const stopWarpSound = () => {
    if (audioLfoRef.current) {
      window.clearInterval(audioLfoRef.current)
      audioLfoRef.current = null
    }

    audioNodesRef.current.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(0)
        gain.gain.linearRampToValueAtTime(0.0001, gain.context.currentTime + 0.08)
        osc.stop(gain.context.currentTime + 0.1)
      } catch {
        osc.stop()
      }
    })
    audioNodesRef.current = []
  }

  const playTestTone = async () => {
    try {
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      if (context.state !== 'running') {
        await context.resume()
      }

      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = 'triangle'
      osc.frequency.value = 740
      gain.gain.value = 0.0001
      osc.connect(gain)
      gain.connect(context.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32)
      osc.stop(context.currentTime + 0.34)
    } catch {
      setError('浏览器阻止了音效播放，请先点击页面任意按钮后重试。')
    }
  }

  const startWarpSound = async () => {
    if (!isWarpSoundEnabled || audioNodesRef.current.length > 0) {
      return
    }

    try {
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      if (context.state !== 'running') {
        await context.resume()
      }

      const master = context.createGain()
      master.gain.value = 0.16
      master.connect(context.destination)

      const baseFrequencies = [148, 222, 333]
      const nodes = baseFrequencies.map((frequency, index) => {
        const osc = context.createOscillator()
        const gain = context.createGain()
        osc.type = index === 1 ? 'sawtooth' : 'triangle'
        osc.frequency.value = frequency
        gain.gain.value = index === 1 ? 0.06 : 0.042
        osc.connect(gain)
        gain.connect(master)
        osc.start()
        return { osc, gain }
      })

      const chirp = context.createOscillator()
      const chirpGain = context.createGain()
      chirp.type = 'triangle'
      chirp.frequency.setValueAtTime(420, context.currentTime)
      chirp.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.45)
      chirpGain.gain.value = 0.0001
      chirp.connect(chirpGain)
      chirpGain.connect(master)
      chirp.start()
      chirpGain.gain.exponentialRampToValueAtTime(0.34, context.currentTime + 0.04)
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5)
      chirp.stop(context.currentTime + 0.55)

      audioNodesRef.current = nodes
      let phase = 0
      audioLfoRef.current = window.setInterval(() => {
        phase += 1
        const detune = Math.sin(phase / 2.8) * 65
        nodes.forEach(({ osc }, index) => {
          osc.detune.setValueAtTime(detune * (index + 1) * 0.4, context.currentTime)
        })
      }, 110)
    } catch {
      setError('浏览器阻止了音效播放，请先点击页面任意按钮后重试。')
      stopWarpSound()
    }
  }

  useEffect(() => {
    if (!isWarpSoundEnabled) {
      stopWarpSound()
    }
  }, [isWarpSoundEnabled])

  useEffect(() => {
    if (!isPredicting) {
      setLoadingStoryIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingStoryIndex((prev) => Math.min(prev + 1, LOADING_STORY.length - 1))
    }, TUNNEL_STEP_MS)

    return () => window.clearInterval(timer)
  }, [isPredicting])

  const startCamera = async (requestedFacing: CameraFacing = cameraFacing, forceRestart = false) => {
    if (isStartingCamera) {
      return
    }
    setError('')
    setIsStartingCamera(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('当前浏览器不支持摄像头调用，请改用 Chrome。')
        return
      }

      const currentStream = streamRef.current
      const activeTracks = currentStream?.getVideoTracks().filter((track) => track.readyState === 'live') ?? []
      if (!forceRestart && currentStream && activeTracks.length > 0) {
        setCapturedImage('')
        setResult(null)
        if (videoRef.current && videoRef.current.srcObject !== currentStream) {
          videoRef.current.srcObject = currentStream
        }

        if (videoRef.current) {
          try {
            await videoRef.current.play()
          } catch {
            currentStream.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            videoRef.current.srcObject = null
          }
        }

        if (streamRef.current) {
          setIsCameraOn(true)
          setStatus(`镜头已就绪（${requestedFacing === 'user' ? '前置' : '后置'}），请直接拍照`)
          return
        }
      }

      // Ensure old stream is released before re-opening camera, avoiding stale-track behavior.
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: requestedFacing },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      setCameraFacing(requestedFacing)
      if (navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          setAvailableCameraCount(devices.filter((device) => device.kind === 'videoinput').length)
        } catch {
          // Ignore device enumeration failures after successful camera startup.
        }
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCapturedImage('')
      setResult(null)
      setIsCameraOn(true)
      setStatus(`请看向${requestedFacing === 'user' ? '前置' : '后置'}镜头，点击“拍照”`)
    } catch (cameraError) {
      setError(getCameraErrorMessage(cameraError))
    } finally {
      setIsStartingCamera(false)
    }
  }

  const toggleCameraFacing = async () => {
    const nextFacing: CameraFacing = cameraFacing === 'user' ? 'environment' : 'user'
    setCameraFacing(nextFacing)

    if (!isCameraOn) {
      setStatus(`已切换为${nextFacing === 'user' ? '前置' : '后置'}镜头，点击“启动时空镜头”即可使用`)
      return
    }

    await startCamera(nextFacing, true)
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsCameraOn(false)
    setIsStartingCamera(false)
    setStatus('摄像头已关闭')
  }

  const takePhoto = () => {
    if (!videoRef.current) {
      return
    }

    const compressed = captureCompressedPhoto(videoRef.current)
    if (!compressed) {
      setError('拍照失败，请重试。')
      return
    }

    setCapturedImage(compressed.dataUrl)
    setResult(null)
    const sizeMb = (compressed.bytes / (1024 * 1024)).toFixed(2)
    setStatus(`照片已捕获（约 ${sizeMb}MB），点击“预测未来职业”`)
  }

  const requestGenderPreview = async () => {
    const response = await fetch(`${API_BASE}/api/face/attributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image_data: capturedImage, max_face_number: 1 }),
    })

    const data: FaceAttributesResponse | { detail?: string } = await response.json()
    if (response.status === 401) {
      setToken('')
      throw new Error('登录已失效，请重新登录。')
    }
    if (!response.ok) {
      throw new Error((data as { detail?: string }).detail ?? '性别识别失败，请重试。')
    }

    const okData = data as FaceAttributesResponse
    const gender = asString(okData.faces?.[0]?.gender?.label).toLowerCase()
    if (gender !== 'female' && gender !== 'male') {
      throw new Error('未识别到有效性别，请调整姿态后重试。')
    }
    return gender as 'female' | 'male'
  }

  const predictWithConfirmedGender = async () => {
    if (!confirmGender) {
      return
    }
    if (!trimmedParticipantClass || !isClassValid) {
      setError('班级必须是三位数字且中间为0，例如 408。')
      return
    }
    if (!trimmedParticipantName || !isNameValid) {
      setError('姓名仅支持中文、英文和空格。')
      return
    }

    setShowConfirmDialog(false)
    setError('')
    setIsPredicting(true)
    void startWarpSound()
    setPendingResult(null)
    setPendingReviewItem(null)
    setResult(null)
    setStatus('正在预测未来职业...')

    try {
      const response = await fetch(`${API_BASE}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participant_class: trimmedParticipantClass,
          participant_name: trimmedParticipantName,
          confirmed_gender: confirmGender,
          image_data: capturedImage,
        }),
      })

      const data = await response.json()
      if (response.status === 401) {
        setToken('')
        throw new Error('登录已失效，请重新登录。')
      }
      if (!response.ok) {
        throw new Error(data.detail ?? '预测失败，请重试。')
      }

      const reviewItem: ReviewItem = {
        predictionId: data.prediction_id,
        participantClass: data.participant_class || trimmedParticipantClass,
        name: trimmedParticipantName,
        profession: data.profession,
        imageUrl: data.generated_image_url,
        capturedImageUrl: data.captured_image_url || capturedImage || undefined,
      }

      setPendingResult(data)
      setPendingReviewItem(reviewItem)
      setStatus('艾小语正在穿越时空隧道，准备带回未来照片...')
    } catch (predictError) {
      setError(
        predictError instanceof Error ? predictError.message : '请求失败，请稍后再试。',
      )
      setPendingResult(null)
      setPendingReviewItem(null)
      setStatus('预测失败')
      setIsPredicting(false)
      stopWarpSound()
    }
  }

  const predict = async () => {
    if (!trimmedParticipantClass) {
      setError('请输入班级。')
      return
    }

    if (!isClassValid) {
      setError('班级必须是三位数字且中间为0，例如 408。')
      return
    }

    if (!trimmedParticipantName) {
      setError('请输入姓名。')
      return
    }

    if (!isNameValid) {
      setError('姓名仅支持中文、英文和空格，请勿输入特殊符号。')
      return
    }

    if (!capturedImage) {
      setError('请先拍照。')
      return
    }

    try {
      setError('')
      setIsPreparingConfirm(true)
      setStatus('艾小语正在收集你的信息，请稍候...')
      const gender = await requestGenderPreview()
      setConfirmGender(gender)
      setShowConfirmDialog(true)
      setStatus('请确认班级、姓名和性别后继续。')
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : '请求失败，请稍后再试。',
      )
      setShowConfirmDialog(false)
      setStatus('识别失败，请重试。')
    } finally {
      setIsPreparingConfirm(false)
    }
  }

  useEffect(() => {
    if (!isPredicting || !pendingResult || !pendingReviewItem) {
      return
    }
    if (loadingStoryIndex < LOADING_STORY.length - 1) {
      return
    }

    const revealTimer = window.setTimeout(() => {
      setResult(pendingResult)
      setRecentReviewList((prev) => [
        pendingReviewItem,
        ...prev.filter((item) => item.predictionId !== pendingReviewItem.predictionId),
      ].slice(0, MAIN_RECENT_LIMIT))
      setReviewList((prev) => [
        pendingReviewItem,
        ...prev.filter((item) => item.predictionId !== pendingReviewItem.predictionId),
      ])
      setPendingResult(null)
      setPendingReviewItem(null)
      setIsPredicting(false)
      // Clear previous snapshot so the next participant sees live camera immediately.
      setCapturedImage('')
      setParticipantClass('')
      setParticipantName('')
      setConfirmGender('')
      setShowConfirmDialog(false)
      setStatus('预测完成，艾小语已带回未来照片。请下一位同学直接拍照继续。')
      stopWarpSound()
    }, TUNNEL_REVEAL_DELAY_MS)

    return () => window.clearTimeout(revealTimer)
  }, [isPredicting, pendingResult, pendingReviewItem, loadingStoryIndex])

  const login = async () => {
    if (!loginName.trim() || !loginPassword.trim()) {
      setLoginError('请输入账号和密码。')
      return
    }

    setLoginError('')
    setIsLoggingIn(true)
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginName.trim(),
          password: loginPassword,
        }),
      })

      const data: LoginResponse | { detail?: string } = await response.json()
      if (!response.ok || !('access_token' in data)) {
        throw new Error((data as { detail?: string }).detail ?? '登录失败，请重试。')
      }

      setToken(data.access_token)
      setLoginPassword('')
      setStatus('登录成功，请开启摄像头。')
    } catch (authError) {
      if (authError instanceof TypeError && authError.message.includes('Failed to fetch')) {
        const resolvedApi = API_BASE || window.location.origin
        setLoginError(`登录请求失败：无法连接到 ${resolvedApi}，请确认后端已启动，或本地开发代理已生效。`)
      } else {
        setLoginError(authError instanceof Error ? authError.message : '登录失败，请重试。')
      }
    } finally {
      setIsLoggingIn(false)
    }
  }

  const logout = () => {
    stopWarpSound()
    setToken('')
    setResult(null)
    setReviewList([])
    setRecentReviewList([])
    setParticipantClass('')
    setCapturedImage('')
    setIsCameraOn(false)
    setStatus('已退出登录')
  }

  const toggleSelection = (predictionId: string) => {
    setSelectedPredictionIds((prev) => {
      if (prev.includes(predictionId)) {
        return prev.filter((id) => id !== predictionId)
      }
      return [...prev, predictionId]
    })
  }

  const selectAllFiltered = () => {
    const ids = adminFilteredList.map((item) => item.predictionId)
    setSelectedPredictionIds((prev) => Array.from(new Set([...prev, ...ids])))
  }

  const clearSelection = () => {
    setSelectedPredictionIds([])
  }

  const adminDeleteSelected = async () => {
    if (selectedPredictionIds.length === 0) {
      setError('请先勾选要删除的照片。')
      return
    }

    if (!window.confirm(`确认删除已选中的 ${selectedPredictionIds.length} 张照片吗？`)) {
      return
    }

    setError('')
    setIsAdminWorking(true)
    try {
      const response = await fetch(`${API_BASE}/api/admin/history/delete-selected`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prediction_ids: selectedPredictionIds,
        }),
      })
      const data = await response.json()
      if (response.status === 401) {
        setToken('')
        throw new Error('登录已失效，请重新登录。')
      }
      if (!response.ok) {
        throw new Error(data.detail ?? '删除失败，请重试。')
      }

      const deletedIds = new Set(selectedPredictionIds)
      setReviewList((prev) => prev.filter((item) => !deletedIds.has(item.predictionId)))
      setRecentReviewList((prev) => prev.filter((item) => !deletedIds.has(item.predictionId)))
      setSelectedPredictionIds([])
      setStatus(`已删除 ${deletedIds.size} 张历史照片。`)
      if (result && deletedIds.has(result.prediction_id)) {
        setResult(null)
      }
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : '删除失败，请重试。')
    } finally {
      setIsAdminWorking(false)
    }
  }

  const adminClearReset = async () => {
    if (!window.confirm('确认一键清空所有历史照片并重置职业池吗？此操作不可撤销。')) {
      return
    }

    setError('')
    setIsAdminWorking(true)
    try {
      const response = await fetch(`${API_BASE}/api/admin/history/clear-reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (response.status === 401) {
        setToken('')
        throw new Error('登录已失效，请重新登录。')
      }
      if (!response.ok) {
        throw new Error(data.detail ?? '清空失败，请重试。')
      }

      setReviewList([])
      setRecentReviewList([])
      setSelectedPredictionIds([])
      setResult(null)
      setStatus('已清空历史照片并重置职业池。')
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : '清空失败，请重试。')
    } finally {
      setIsAdminWorking(false)
    }
  }

  const exportWallToLocal = async () => {
    if (reviewList.length === 0) {
      setError('当前没有可导出的照片。')
      return
    }

    setIsExportingWall(true)
    setError('')
    setStatus('正在导出纪念墙，请稍候...')
    const objectUrls: string[] = []
    try {
      const normalizeImageUrl = (src: string) => {
        try {
          const parsed = new URL(src, window.location.origin)
          if (parsed.pathname.startsWith('/generated/')) {
            return `${window.location.origin}${parsed.pathname}${parsed.search}`
          }
          return parsed.toString()
        } catch {
          return src
        }
      }

      const loadImageFromUrl = (url: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('图片加载失败'))
          image.src = url
        })

      const loadImage = async (src: string) => {
        const normalizedSrc = normalizeImageUrl(src)
        if (src.startsWith('data:')) {
          return loadImageFromUrl(src)
        }

        try {
          const response = await fetch(normalizedSrc)
          if (!response.ok) {
            throw new Error('图片请求失败')
          }
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          objectUrls.push(objectUrl)
          return await loadImageFromUrl(objectUrl)
        } catch {
          return loadImageFromUrl(normalizedSrc)
        }
      }

      const drawImageOrPlaceholder = async (
        src: string,
        draw: (img: HTMLImageElement) => void,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => {
        try {
          const image = await loadImage(src)
          draw(image)
          return true
        } catch {
          context!.fillStyle = '#13284d'
          context!.fillRect(x, y, w, h)
          context!.fillStyle = '#9ddffc'
          context!.font = '14px Segoe UI, sans-serif'
          context!.textAlign = 'center'
          context!.fillText('图片加载失败', x + w / 2, y + h / 2)
          context!.textAlign = 'left'
          return false
        }
      }

      const columns = reviewList.length > 20 ? 5 : 4
      const cardWidth = 280
      const cardHeight = 360
      const gap = 16
      const padding = 30
      const titleHeight = 90
      const rows = Math.ceil(reviewList.length / columns)
      const canvasWidth = padding * 2 + columns * cardWidth + (columns - 1) * gap
      const canvasHeight = padding * 2 + titleHeight + rows * cardHeight + (rows - 1) * gap

      const canvas = document.createElement('canvas')
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('导出失败，请重试。')
      }

      context.fillStyle = '#040a18'
      context.fillRect(0, 0, canvasWidth, canvasHeight)
      context.fillStyle = '#c5ecff'
      context.font = 'bold 40px Segoe UI, sans-serif'
      context.fillText('未来职业纪念墙', padding, 56)
      context.font = '22px Segoe UI, sans-serif'
      context.fillStyle = '#90d9f8'
      context.fillText(`已采集 ${reviewList.length} 位 · 导出时间 ${new Date().toLocaleString()}`, padding, 86)

      let failedImageCount = 0
      for (let index = 0; index < reviewList.length; index += 1) {
        const item = reviewList[index]
        const row = Math.floor(index / columns)
        const col = index % columns
        const x = padding + col * (cardWidth + gap)
        const y = padding + titleHeight + row * (cardHeight + gap)

        context.fillStyle = '#0d1a35'
        context.fillRect(x, y, cardWidth, cardHeight)
        context.strokeStyle = '#2a4a78'
        context.lineWidth = 2
        context.strokeRect(x, y, cardWidth, cardHeight)

        if (item.capturedImageUrl) {
          // Draw "现在" + "未来" side by side
          const halfW = Math.floor((cardWidth - 16 - 6) / 2)
          const imgH = halfW
          const nowOk = await drawImageOrPlaceholder(
            item.capturedImageUrl,
            (img) => context.drawImage(img, x + 8, y + 8, halfW, imgH),
            x + 8,
            y + 8,
            halfW,
            imgH,
          )
          const futureOk = await drawImageOrPlaceholder(
            item.imageUrl,
            (img) => context.drawImage(img, x + 8 + halfW + 6, y + 8, halfW, imgH),
            x + 8 + halfW + 6,
            y + 8,
            halfW,
            imgH,
          )
          if (!nowOk) failedImageCount += 1
          if (!futureOk) failedImageCount += 1
          // Labels
          context.fillStyle = 'rgba(0,0,0,0.5)'
          context.fillRect(x + 8, y + 8 + imgH - 20, halfW, 20)
          context.fillRect(x + 8 + halfW + 6, y + 8 + imgH - 20, halfW, 20)
          context.fillStyle = 'rgba(255,255,255,0.9)'
          context.font = 'bold 13px Segoe UI, sans-serif'
          context.textAlign = 'center'
          context.fillText('现在', x + 8 + halfW / 2, y + imgH - 4)
          context.fillText('未来', x + 8 + halfW + 6 + halfW / 2, y + imgH - 4)
          context.textAlign = 'left'

          context.fillStyle = '#f2fdff'
          context.font = 'bold 22px Segoe UI, sans-serif'
          context.fillText(item.name, x + 12, y + imgH + 24)
          context.fillStyle = '#9ddffc'
          context.font = '18px Segoe UI, sans-serif'
          context.fillText(item.profession, x + 12, y + imgH + 52)
        } else {
          const singleOk = await drawImageOrPlaceholder(
            item.imageUrl,
            (img) => context.drawImage(img, x + 8, y + 8, cardWidth - 16, cardWidth - 16),
            x + 8,
            y + 8,
            cardWidth - 16,
            cardWidth - 16,
          )
          if (!singleOk) failedImageCount += 1

          context.fillStyle = '#f2fdff'
          context.font = 'bold 22px Segoe UI, sans-serif'
          context.fillText(item.name, x + 12, y + cardWidth + 24)
          context.fillStyle = '#9ddffc'
          context.font = '18px Segoe UI, sans-serif'
          context.fillText(item.profession, x + 12, y + cardWidth + 52)
        }
      }

      const outputBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      })
      if (!outputBlob) {
        throw new Error('导出失败，请重试。')
      }

      const outputUrl = URL.createObjectURL(outputBlob)
      const link = document.createElement('a')
      link.href = outputUrl
      link.download = `future-wall-${new Date().toISOString().slice(0, 10)}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(outputUrl)

      if (failedImageCount > 0) {
        setStatus(`纪念墙已导出（${failedImageCount} 张图片加载失败，已用占位图替代）。`)
      } else {
        setStatus('纪念墙已导出到本地。')
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败，请重试。')
    } finally {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      setIsExportingWall(false)
    }
  }

  const exportAllImagesToZip = async () => {
    if (reviewList.length === 0) {
      setError('当前没有可导出的照片。')
      return
    }

    setIsExportingAllImages(true)
    setError('')
    setStatus('正在打包所有照片，请稍候...')
    try {
      const zip = new JSZip()

      const sanitizeFileName = (input: string) => {
        const cleaned = input
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/\s+/g, ' ')
          .trim()
        return cleaned || '未命名'
      }

      const normalizeImageUrl = (src: string) => {
        try {
          const parsed = new URL(src, window.location.origin)
          if (parsed.pathname.startsWith('/generated/')) {
            return `${window.location.origin}${parsed.pathname}${parsed.search}`
          }
          return parsed.toString()
        } catch {
          return src
        }
      }

      const inferExtension = (blobType: string, src: string) => {
        if (blobType.includes('png')) return 'png'
        if (blobType.includes('webp')) return 'webp'
        if (blobType.includes('gif')) return 'gif'
        if (blobType.includes('jpeg') || blobType.includes('jpg')) return 'jpg'

        try {
          const pathname = new URL(src, window.location.origin).pathname.toLowerCase()
          if (pathname.endsWith('.png')) return 'png'
          if (pathname.endsWith('.webp')) return 'webp'
          if (pathname.endsWith('.gif')) return 'gif'
          if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) return 'jpg'
        } catch {
          // Ignore parsing error and use fallback extension.
        }

        return 'jpg'
      }

      let exportedCount = 0
      let failedCount = 0

      for (let index = 0; index < reviewList.length; index += 1) {
        const item = reviewList[index]
        const src = normalizeImageUrl(item.imageUrl)
        const rank = String(index + 1).padStart(2, '0')
        const safeName = sanitizeFileName(item.name)
        const safeProfession = sanitizeFileName(item.profession)
        const classFolder = sanitizeFileName(item.participantClass || '未分班')

        try {
          const response = await fetch(src)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }

          const blob = await response.blob()
          const extension = inferExtension(blob.type, src)
          const filename = `${rank}-${safeName}-${safeProfession}.${extension}`
          zip.file(`${classFolder}/${filename}`, blob)
          exportedCount += 1
        } catch (imageError) {
          failedCount += 1
          zip.file(
            `${classFolder}/失败记录/${rank}-${safeName}.txt`,
            `班级: ${item.participantClass || '未分班'}\n姓名: ${item.name}\n职业: ${item.profession}\n图片地址: ${src}\n错误: ${imageError instanceof Error ? imageError.message : '未知错误'}`,
          )
        }
      }

      if (exportedCount === 0) {
        throw new Error('没有成功下载任何图片，请确认回顾墙图片可访问。')
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = zipUrl
      link.download = `future-images-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(zipUrl)

      if (failedCount > 0) {
        setStatus(`批量导出完成：成功 ${exportedCount} 张，失败 ${failedCount} 张（ZIP 内含失败记录）。`)
      } else {
        setStatus(`批量导出完成：共 ${exportedCount} 张。`)
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '批量导出失败，请重试。')
    } finally {
      setIsExportingAllImages(false)
    }
  }

  const exportNowFuturePairsToZip = async () => {
    if (reviewList.length === 0) {
      setError('当前没有可导出的照片。')
      return
    }

    setIsExportingDualImages(true)
    setError('')
    setStatus('正在打包“现在+未来”双图，请稍候...')
    try {
      const zip = new JSZip()

      const sanitizeFileName = (input: string) => {
        const cleaned = input
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/\s+/g, ' ')
          .trim()
        return cleaned || '未命名'
      }

      const normalizeImageUrl = (src: string) => {
        try {
          const parsed = new URL(src, window.location.origin)
          if (parsed.pathname.startsWith('/generated/')) {
            return `${window.location.origin}${parsed.pathname}${parsed.search}`
          }
          return parsed.toString()
        } catch {
          return src
        }
      }

      const inferExtension = (blobType: string, src: string) => {
        if (blobType.includes('png')) return 'png'
        if (blobType.includes('webp')) return 'webp'
        if (blobType.includes('gif')) return 'gif'
        if (blobType.includes('jpeg') || blobType.includes('jpg')) return 'jpg'

        try {
          const pathname = new URL(src, window.location.origin).pathname.toLowerCase()
          if (pathname.endsWith('.png')) return 'png'
          if (pathname.endsWith('.webp')) return 'webp'
          if (pathname.endsWith('.gif')) return 'gif'
          if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) return 'jpg'
        } catch {
          // Ignore parsing error and use fallback extension.
        }

        return 'jpg'
      }

      const addImage = async (label: '现在' | '未来', src: string, baseName: string) => {
        const normalizedSrc = normalizeImageUrl(src)
        const response = await fetch(normalizedSrc)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const blob = await response.blob()
        const extension = inferExtension(blob.type, normalizedSrc)
        zip.file(`${baseName}-${label}.${extension}`, blob)
      }

      let successPairs = 0
      let missingNowCount = 0
      let failedImageCount = 0

      for (let index = 0; index < reviewList.length; index += 1) {
        const item = reviewList[index]
        const rank = String(index + 1).padStart(2, '0')
        const safeName = sanitizeFileName(item.name)
        const safeProfession = sanitizeFileName(item.profession)
        const baseName = `${rank}-${safeName}-${safeProfession}`
        const classFolder = sanitizeFileName(item.participantClass || '未分班')

        let pairOk = true

        if (item.capturedImageUrl) {
          try {
            await addImage('现在', item.capturedImageUrl, `${classFolder}/${baseName}`)
          } catch (error) {
            pairOk = false
            failedImageCount += 1
            zip.file(
              `${classFolder}/失败记录/${baseName}-现在.txt`,
              `班级: ${item.participantClass || '未分班'}\n姓名: ${item.name}\n职业: ${item.profession}\n标签: 现在\n图片地址: ${item.capturedImageUrl}\n错误: ${error instanceof Error ? error.message : '未知错误'}`,
            )
          }
        } else {
          pairOk = false
          missingNowCount += 1
          zip.file(
            `${classFolder}/失败记录/${baseName}-现在缺失.txt`,
            `班级: ${item.participantClass || '未分班'}\n姓名: ${item.name}\n职业: ${item.profession}\n说明: 当前记录没有“现在”照片（老数据通常只包含“未来”图）。`,
          )
        }

        try {
          await addImage('未来', item.imageUrl, `${classFolder}/${baseName}`)
        } catch (error) {
          pairOk = false
          failedImageCount += 1
          zip.file(
            `${classFolder}/失败记录/${baseName}-未来.txt`,
            `班级: ${item.participantClass || '未分班'}\n姓名: ${item.name}\n职业: ${item.profession}\n标签: 未来\n图片地址: ${item.imageUrl}\n错误: ${error instanceof Error ? error.message : '未知错误'}`,
          )
        }

        if (pairOk) {
          successPairs += 1
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = zipUrl
      link.download = `now-future-pairs-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(zipUrl)

      const totalPairs = reviewList.length
      if (failedImageCount > 0 || missingNowCount > 0) {
        setStatus(
          `双图导出完成：完整 ${successPairs}/${totalPairs} 组，缺少现在图 ${missingNowCount} 组，图片下载失败 ${failedImageCount} 张（ZIP 内含失败记录）。`,
        )
      } else {
        setStatus(`双图导出完成：共 ${totalPairs} 组（每人 2 张）。`)
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '双图导出失败，请重试。')
    } finally {
      setIsExportingDualImages(false)
    }
  }

  const loadingStoryText = LOADING_STORY[loadingStoryIndex]
  const yearMatch = loadingStoryText.match(/(20\d{2})年/)
  const activeYear = yearMatch ? Number(yearMatch[1]) : null
  const openAdminPage = () => {
    window.location.hash = '#/admin'
  }
  const openWallPage = () => {
    window.location.hash = '#/wall'
  }
  const openMainPage = () => {
    window.location.hash = '#/'
  }

  if (!token) {
    return (
      <main className="container">
        <section className="login-panel">
          <h1>杭州英特外国语学校（小学部）十岁礼登录</h1>
          <p>请输入活动账号后开始未来职业预测。</p>
          <input
            type="text"
            placeholder="账号"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            maxLength={64}
          />
          <input
            type="password"
            placeholder="密码"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            maxLength={128}
          />
          <button onClick={login} disabled={isLoggingIn}>
            {isLoggingIn ? '登录中...' : '登录并进入时空舱'}
          </button>
          {loginError && <p className="error">{loginError}</p>}
        </section>
        <footer className="app-footer">
          <div className="beian-info">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
              浙ICP备2026022828号
            </a>
            <span className="separator"> | </span>
            <a href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33011002019348" target="_blank" rel="noopener noreferrer">
              <img className="beian-police-icon" src="/beian-police-badge.png" alt="" aria-hidden="true" />
              浙公网安备33011002019348号
            </a>
          </div>
        </footer>
      </main>
    )
  }

  return (
    <main className="container">
      <button className="logout-corner" onClick={logout}>退出登录</button>
      <button className="admin-nav-corner" onClick={viewMode === 'admin' ? openMainPage : openAdminPage}>
        {viewMode === 'admin' ? '返回采集页面' : '管理员页面'}
      </button>
      <button className="wall-nav-corner" onClick={viewMode === 'wall' ? openMainPage : openWallPage}>
        {viewMode === 'wall' ? '返回采集页面' : '职业墙页面'}
      </button>

      {viewMode === 'admin' ? (
        <section className="admin-page">
          <header className="admin-page-header">
            <h1>管理员页面</h1>
            <p>管理历史照片：筛选删除 / 一键清空并重置职业池</p>
          </header>

          <section className="admin-panel">
            <h2>管理工具</h2>
            <p className="admin-hint">默认历史照片长期保留。你可以筛选删除，也可以一键清空并重置。</p>
            <div className="admin-filters">
              <input
                type="text"
                placeholder="按姓名筛选"
                value={adminNameFilter}
                onChange={(event) => setAdminNameFilter(event.target.value)}
                maxLength={50}
              />
              <input
                type="text"
                placeholder="按职业筛选"
                value={adminProfessionFilter}
                onChange={(event) => setAdminProfessionFilter(event.target.value)}
                maxLength={50}
              />
            </div>
            <div className="admin-actions">
              <button type="button" onClick={selectAllFiltered} disabled={isAdminWorking || adminFilteredList.length === 0}>
                全选筛选结果（{adminFilteredList.length}）
              </button>
              <button type="button" onClick={clearSelection} disabled={isAdminWorking || selectedPredictionIds.length === 0}>
                清空选择（{selectedPredictionIds.length}）
              </button>
              <button type="button" onClick={adminDeleteSelected} disabled={isAdminWorking || selectedPredictionIds.length === 0}>
                删除已选（{selectedPredictionIds.length}）
              </button>
              <button type="button" onClick={adminClearReset} disabled={isAdminWorking || reviewList.length === 0}>
                一键清空并重置
              </button>
            </div>
            <div className="admin-actions">
              <button
                type="button"
                onClick={() => {
                  setIsWarpSoundEnabled((prev) => {
                    const next = !prev
                    if (next) {
                      void playTestTone()
                    }
                    return next
                  })
                }}
              >
                {isWarpSoundEnabled ? '关闭时空音效' : '开启时空音效'}
              </button>
              <button type="button" onClick={() => void playTestTone()}>
                测试音效
              </button>
            </div>
          </section>

          <section className="review-panel">
            <div className="review-header">
              <h2>历史照片列表</h2>
              <span>已选 {selectedInFilteredCount} / 筛选 {adminFilteredList.length}</span>
            </div>
            {adminFilteredList.length === 0 ? (
              <p className="review-empty">当前筛选条件下暂无记录。</p>
            ) : (
              <div className="review-grid">
                {adminFilteredList.map((item) => (
                  <article
                    key={item.predictionId}
                    className={selectedIdSet.has(item.predictionId) ? 'review-card review-card-selected' : 'review-card'}
                    onClick={() => toggleSelection(item.predictionId)}
                  >
                    <label className="card-check" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(item.predictionId)}
                        onChange={() => toggleSelection(item.predictionId)}
                      />
                      选择
                    </label>
                    <img src={item.imageUrl} alt={item.name} className="review-image" />
                    <p className="review-name">{item.name}</p>
                    <p className="review-profession">{item.profession}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : (
        <>
          {viewMode === 'main' && (
          <>
          <header className="hero-header">
            <div className="hero-badge">杭州英特外国语学校（小学部）</div>
            <div className="drop-row" aria-hidden="true">
              <span>💧</span>
              <span>💧</span>
              <span>💧</span>
            </div>
            <h1>艾小语时空隧道 · 未来职业预测</h1>
            <p>🎉 十岁礼特别环节：杭州英特外国语学校（小学部）的同学们勇敢出发，一起预测闪闪发光的未来职业</p>
          </header>

          <section className="workspace-panel">
            <section className="camera-panel">
              <div className="camera-frame">
                {capturedImage ? (
                  <img src={capturedImage} alt="captured" className="preview" />
                ) : (
                  <video ref={videoRef} autoPlay playsInline muted className="preview" />
                )}
                {availableCameraCount > 1 && (
                  <button
                    type="button"
                    className="camera-switch-button"
                    onClick={() => void toggleCameraFacing()}
                    disabled={isStartingCamera || isPredicting}
                    aria-label={cameraFacing === 'user' ? '切换到后置镜头' : '切换到前置镜头'}
                    title={cameraFacing === 'user' ? '切换后置镜头' : '切换前置镜头'}
                  >
                    ↺
                  </button>
                )}
              </div>

              <div className="controls">
                <input
                  type="text"
                  placeholder="请输入班级（如 408）"
                  value={participantClass}
                  onChange={(event) => setParticipantClass(event.target.value)}
                  maxLength={3}
                />
                {!!trimmedParticipantClass && !isClassValid && (
                  <p className="error">班级必须是三位数字且中间为0，例如 408。</p>
                )}
                <input
                  type="text"
                  placeholder="请输入姓名（必填）"
                  value={participantName}
                  onChange={(event) => setParticipantName(event.target.value)}
                  maxLength={50}
                />
                {!!trimmedParticipantName && !isNameValid && (
                  <p className="error">姓名仅支持中文、英文和空格。</p>
                )}
                <div className="button-row">
                  <button onClick={() => void startCamera()} disabled={isStartingCamera || isPredicting}>
                    {isStartingCamera ? '镜头启动中...' : '启动时空镜头'}
                  </button>
                  <button onClick={stopCamera} disabled={!isCameraOn || isStartingCamera}>
                    关闭时空镜头
                  </button>
                  <button onClick={takePhoto} disabled={!isCameraOn || isStartingCamera}>
                    定格当前时空
                  </button>
                  <button onClick={predict} disabled={isPredicting || isPreparingConfirm || !capturedImage || !trimmedParticipantName || !trimmedParticipantClass || !isNameValid || !isClassValid}>
                    {isPredicting ? '时空穿梭中...' : '开启时空预测'}
                  </button>
                </div>
                <p className="status">{status}</p>
                {displayErrorMessage && <p className="error">{displayErrorMessage}</p>}
              </div>
            </section>

            <section className="result-panel result-panel-inline">
              <div className="result-panel-tag">艾小语未来职业舱</div>
              <div className="result-content">
                {isPredicting ? (
                  <div className="future-loading">
                    <div className="quantum-scene" aria-hidden="true">
                      <span className="orbit orbit-1"></span>
                      <span className="orbit orbit-2"></span>
                      <span className="orbit orbit-3"></span>
                      <span className="scan-line"></span>
                      <span className="mascot-drop">💧</span>
                    </div>
                    <p className="loading-title">艾小语时空穿梭中...</p>
                    <p className="loading-line">{loadingStoryText}</p>
                    <div className="year-stream" aria-label="时间穿梭年份">
                      {FUTURE_YEARS.map((year) => (
                        <span
                          key={year}
                          className={activeYear === year ? 'year-chip year-chip-active' : 'year-chip'}
                        >
                          {year}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : result ? (
                  <img src={result.generated_image_url} alt={result.profession} className="result-image" />
                ) : (
                  <div className="result-placeholder tunnel-standby">
                    <div className="tunnel-core" aria-hidden="true">
                      <span className="tunnel-ring tunnel-ring-1"></span>
                      <span className="tunnel-ring tunnel-ring-2"></span>
                      <span className="tunnel-ring tunnel-ring-3"></span>
                      <span className="tunnel-dot">💧</span>
                    </div>
                    <p>艾小语时空隧道待命中。</p>
                  </div>
                )}
              </div>
              <h2 className="result-panel-title result-panel-title-bottom">
                {result ? `未来职业结果：${result.profession}` : '未来职业结果区'}
              </h2>
              <div className="result-footnote">
                {result
                  ? `未来职业解读：${result.participant_name} 具备「${result.profession}」潜质，继续保持好奇与行动力。`
                  : '提示：请先完成左侧时空仓采集，再点击“开启时空预测”，右侧将展示未来职业形象。'}
              </div>
            </section>
          </section>

          <section className="review-panel">
            <div className="review-header">
              <h2>最近采集记录</h2>
              <span>本次 {recentReviewList.length} 位</span>
            </div>
            <div className="wall-tools">
              <label>
                每页
                <select value={mainWallPageSize} onChange={(event) => { setMainWallPageSize(Number(event.target.value)); setMainWallPage(1) }}>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
                条
              </label>
              <button type="button" onClick={() => setMainWallPage((prev) => Math.max(1, prev - 1))} disabled={mainWallPage <= 1}>上一页</button>
              <span>第 {mainWallPage} / {mainWallTotalPages} 页</span>
              <button type="button" onClick={() => setMainWallPage((prev) => Math.min(mainWallTotalPages, prev + 1))} disabled={mainWallPage >= mainWallTotalPages}>下一页</button>
            </div>
            {mainWallItems.length === 0 ? (
              <p className="review-empty">当前页面只显示本次新采集的照片，历史记录请前往职业墙查看。</p>
            ) : (
              <div className="review-grid">
                {mainWallItems.map((item) => (
                  <article key={item.predictionId} className="review-card">
                    {item.capturedImageUrl ? (
                      <div className="review-dual-images">
                        <div className="review-img-wrap">
                          <img src={item.capturedImageUrl} alt={`${item.name} 现在`} className="review-image" />
                          <span className="review-img-label">现在</span>
                        </div>
                        <div className="review-img-wrap">
                          <img src={item.imageUrl} alt={`${item.name} 未来`} className="review-image" />
                          <span className="review-img-label">未来</span>
                        </div>
                      </div>
                    ) : (
                      <img src={item.imageUrl} alt={item.name} className="review-image" />
                    )}
                    <p className="review-name">{item.participantClass ? `${item.participantClass} · ` : ''}{item.name}</p>
                    <p className="review-profession">{item.profession}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
          </>
          )}

          {viewMode === 'wall' && (
          <section className={wallFocusMode ? 'review-panel review-panel-fullscreen' : 'review-panel'}>
            {slideshowMode && reviewList.length > 0 && (() => {
              const item = reviewList[slideshowIndex % reviewList.length]
              return (
                <div className="slideshow-overlay">
                  <div className="slideshow-counter">{slideshowIndex + 1} / {reviewList.length}</div>
                  <div className="slideshow-top-right">
                    <button
                      type="button"
                      className="slideshow-music-btn"
                      onClick={() => setSlideshowMusicOn((prev) => !prev)}
                      aria-label={slideshowMusicOn ? '关闭音乐' : '开启音乐'}
                      title={slideshowMusicOn ? '关闭音乐' : '开启音乐'}
                    >
                      {slideshowMusicOn ? '🔊' : '🔇'}
                    </button>
                    <button
                      type="button"
                      className="slideshow-exit-btn"
                      onClick={() => setSlideshowMode(false)}
                    >
                      ✕ 退出播放
                    </button>
                  </div>
                  <button
                    type="button"
                    className="slideshow-nav slideshow-prev"
                    onClick={() => setSlideshowIndex((prev) => (prev - 1 + reviewList.length) % reviewList.length)}
                    aria-label="上一位"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="slideshow-nav slideshow-next"
                    onClick={() => setSlideshowIndex((prev) => (prev + 1) % reviewList.length)}
                    aria-label="下一位"
                  >
                    ›
                  </button>
                  <div className="slideshow-content" key={item.predictionId}>
                    <div className="slideshow-photos">
                      {item.capturedImageUrl && (
                        <div className="slideshow-photo-wrap">
                          <img src={item.capturedImageUrl} alt="现在" className="slideshow-photo" />
                          <span className="slideshow-photo-label">现在</span>
                        </div>
                      )}
                      <div className="slideshow-photo-wrap">
                        <img src={item.imageUrl} alt="未来" className="slideshow-photo" />
                        <span className="slideshow-photo-label">{item.capturedImageUrl ? '未来' : item.profession}</span>
                      </div>
                    </div>
                    <div className="slideshow-info">
                      <p className="slideshow-name">{item.name}</p>
                      <p className="slideshow-profession">{item.profession}</p>
                    </div>
                  </div>
                  <div className="slideshow-dots">
                    {reviewList.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={i === slideshowIndex ? 'slideshow-dot slideshow-dot-active' : 'slideshow-dot'}
                        onClick={() => setSlideshowIndex(i)}
                        aria-label={`跳转至第${i + 1}位`}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}
            {wallFocusMode && (
              <button
                type="button"
                className="wall-exit-btn"
                onClick={() => setWallFocusMode(false)}
                aria-label="退出大屏展示"
              >
                ✕ 退出大屏
              </button>
            )}
            <div className="review-header">
              <h2>未来职业回顾墙</h2>
              <span>已采集 {reviewList.length} 位</span>
            </div>
            <p className="review-subtitle">杭州英特外国语学校（小学部） · 同学们十岁礼纪念墙</p>
            <div className="wall-tools">
              <button type="button" onClick={() => setWallFocusMode((prev) => !prev)}>
                {wallFocusMode ? '退出大屏展示' : '最大化职业墙'}
              </button>
              <button
                type="button"
                onClick={() => setWallAutoScroll((prev) => !prev)}
                disabled={!wallFocusMode}
              >
                {wallAutoScroll ? '关闭自动滚动' : '开启自动滚动'}
              </button>
              <button type="button" onClick={exportWallToLocal} disabled={isExportingWall}>
                {isExportingWall ? '导出中...' : '一键导出纪念图'}
              </button>
              <button type="button" onClick={exportAllImagesToZip} disabled={isExportingAllImages}>
                {isExportingAllImages ? '打包中...' : '导出全部单人图（ZIP）'}
              </button>
              <button type="button" onClick={exportNowFuturePairsToZip} disabled={isExportingDualImages}>
                {isExportingDualImages ? '打包中...' : '导出现在+未来双图（ZIP）'}
              </button>
              {wallFocusMode && reviewList.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSlideshowIndex(0); setSlideshowMode(true) }}
                >
                  ▶ 循环播放
                </button>
              )}
            </div>

            {isHistoryLoading && reviewList.length === 0 ? (
              <p className="review-empty">正在加载职业墙内容...</p>
            ) : reviewList.length === 0 ? (
              <p className="review-empty">完成预测后，照片会展示在这里，方便全年级一起回顾。</p>
            ) : (
              <div
                ref={wallScrollRef}
                className={wallFocusMode ? 'review-grid review-grid-wall-mode' : 'review-grid'}
              >
                {reviewList.map((item) => (
                  <article key={item.predictionId} className="review-card">
                    {item.capturedImageUrl ? (
                      <div className="review-dual-images">
                        <div className="review-img-wrap">
                          <img src={item.capturedImageUrl} alt={`${item.name} 现在`} className="review-image" />
                          <span className="review-img-label">现在</span>
                        </div>
                        <div className="review-img-wrap">
                          <img src={item.imageUrl} alt={`${item.name} 未来`} className="review-image" />
                          <span className="review-img-label">未来</span>
                        </div>
                      </div>
                    ) : (
                      <img src={item.imageUrl} alt={item.name} className="review-image" />
                    )}
                    <p className="review-name">{item.participantClass ? `${item.participantClass} · ` : ''}{item.name}</p>
                    <p className="review-profession">{item.profession}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
          )}

          {showConfirmDialog && (
            <div className="confirm-overlay">
              <div className="confirm-modal">
                <h3>请确认采集信息</h3>
                {capturedImage && <img src={capturedImage} alt="采集头像缩略图" className="confirm-avatar" />}
                <div className="confirm-form">
                  <input
                    type="text"
                    className="confirm-input"
                    placeholder="班级（如 408）"
                    value={participantClass}
                    onChange={(event) => setParticipantClass(event.target.value)}
                    maxLength={3}
                  />
                  {!!trimmedParticipantClass && !isClassValid && (
                    <p className="error">班级必须是三位数字且中间为0，例如 408。</p>
                  )}
                  <input
                    type="text"
                    className="confirm-input"
                    placeholder="姓名"
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                    maxLength={50}
                  />
                  {!!trimmedParticipantName && !isNameValid && (
                    <p className="error">姓名仅支持中文、英文和空格。</p>
                  )}
                  <select
                    id="confirm-gender"
                    className="confirm-select"
                    value={confirmGender}
                    onChange={(event) => setConfirmGender((event.target.value as 'female' | 'male' | ''))}
                  >
                    <option value="female">女</option>
                    <option value="male">男</option>
                  </select>
                </div>
                <div className="button-row confirm-actions">
                  <button type="button" onClick={() => setShowConfirmDialog(false)} disabled={isPredicting}>返回修改</button>
                  <button type="button" onClick={() => void predictWithConfirmedGender()} disabled={isPredicting || !canSubmitConfirmed}>确认并预测</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <footer className="app-footer">
        <div className="beian-info">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            浙ICP备2026022828号
          </a>
          <span className="separator"> | </span>
          <a href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33011002019348" target="_blank" rel="noopener noreferrer">
            <img className="beian-police-icon" src="/beian-police-badge.png" alt="" aria-hidden="true" />
            浙公网安备33011002019348号
          </a>
        </div>
      </footer>
    </main>
  )
}

export default App
