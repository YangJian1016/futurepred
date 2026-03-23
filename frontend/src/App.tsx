import { useEffect, useRef, useState } from 'react'
import './App.css'

type PredictResponse = {
  prediction_id: string
  participant_name: string
  profession: string
  profession_index: number
  total_professions: number
  status_text: string
  image_prompt: string
  generated_image_url: string
  image_provider?: string
}

type LoginResponse = {
  access_token: string
  token_type: string
  expires_in: number
}

type ReviewItem = {
  predictionId: string
  name: string
  profession: string
  imageUrl: string
  capturedImageUrl?: string
}

type HistoryItemResponse = {
  prediction_id: string
  participant_name: string
  profession: string
  generated_image_url: string
  image_provider: string
  created_at: string
}

type HistoryListResponse = {
  items: HistoryItemResponse[]
  count: number
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
const REVIEW_STORAGE_KEY = 'futurepred-review-wall'
const AUTH_STORAGE_KEY = 'futurepred-access-token'
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
const TUNNEL_TARGET_TOTAL_MS = 20_000
const TUNNEL_REVEAL_DELAY_MS = 650
const TUNNEL_STEP_MS = Math.max(
  320,
  Math.round((TUNNEL_TARGET_TOTAL_MS - TUNNEL_REVEAL_DELAY_MS) / Math.max(1, LOADING_STORY.length - 1)),
)

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
  const [capturedImage, setCapturedImage] = useState('')
  const [result, setResult] = useState<PredictResponse | null>(null)
  const [status, setStatus] = useState('点击“开启摄像头”开始')
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isPredicting, setIsPredicting] = useState(false)
  const [error, setError] = useState('')
  const [pendingResult, setPendingResult] = useState<PredictResponse | null>(null)
  const [pendingReviewItem, setPendingReviewItem] = useState<ReviewItem | null>(null)
  const [reviewList, setReviewList] = useState<ReviewItem[]>([])
  const [token, setToken] = useState('')
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loadingStoryIndex, setLoadingStoryIndex] = useState(0)
  const [isWarpSoundEnabled, setIsWarpSoundEnabled] = useState(true)
  const [adminNameFilter, setAdminNameFilter] = useState('')
  const [adminProfessionFilter, setAdminProfessionFilter] = useState('')
  const [isAdminWorking, setIsAdminWorking] = useState(false)
  const [selectedPredictionIds, setSelectedPredictionIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'main' | 'admin'>('main')
  const [wallFocusMode, setWallFocusMode] = useState(false)
  const [wallAutoScroll, setWallAutoScroll] = useState(false)
  const [isExportingWall, setIsExportingWall] = useState(false)
  const [slideshowMode, setSlideshowMode] = useState(false)
  const [slideshowIndex, setSlideshowIndex] = useState(0)
  const [slideshowMusicOn, setSlideshowMusicOn] = useState(true)

  const trimmedParticipantName = participantName.trim()
  const isNameValid = NAME_PATTERN.test(trimmedParticipantName)
  const normalizedNameFilter = adminNameFilter.trim().toLowerCase()
  const normalizedProfessionFilter = adminProfessionFilter.trim().toLowerCase()
  const adminFilteredList = reviewList.filter((item) => {
    const matchName = !normalizedNameFilter || item.name.toLowerCase().includes(normalizedNameFilter)
    const matchProfession = !normalizedProfessionFilter || item.profession.toLowerCase().includes(normalizedProfessionFilter)
    return matchName && matchProfession
  })
  const selectedIdSet = new Set(selectedPredictionIds)
  const selectedInFilteredCount = adminFilteredList.filter((item) => selectedIdSet.has(item.predictionId)).length
  const displayErrorMessage = error.trim().toLowerCase() === 'not found'
    ? '接口未找到，请确认后端服务已启动且 API 地址配置正确。'
    : error

  useEffect(() => {
    const applyHashView = () => {
      setViewMode(window.location.hash === '#/admin' ? 'admin' : 'main')
    }

    applyHashView()
    window.addEventListener('hashchange', applyHashView)
    return () => window.removeEventListener('hashchange', applyHashView)
  }, [])

  useEffect(() => {
    const savedToken = localStorage.getItem(AUTH_STORAGE_KEY) || ''
    setToken(savedToken)

    try {
      const cache = localStorage.getItem(REVIEW_STORAGE_KEY)
      if (!cache) {
        return
      }
      const parsed = JSON.parse(cache) as ReviewItem[]
      if (Array.isArray(parsed)) {
        setReviewList(parsed)
      }
    } catch {
      setReviewList([])
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviewList))
  }, [reviewList])

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
      name: item.participant_name,
      profession: item.profession,
      imageUrl: item.generated_image_url,
    }))
    setReviewList(mapped)
    setSelectedPredictionIds([])
  }

  useEffect(() => {
    if (!token) {
      return
    }

    loadHistory(token).catch((historyError) => {
      setError(historyError instanceof Error ? historyError.message : '历史记录加载失败')
    })
  }, [token])

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

  const startCamera = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('当前浏览器不支持摄像头调用，请改用 Chrome。')
        return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCapturedImage('')
      setResult(null)
      setIsCameraOn(true)
      setStatus('请看向镜头，点击“拍照”')
    } catch (cameraError) {
      setError(getCameraErrorMessage(cameraError))
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsCameraOn(false)
    setStatus('摄像头已关闭')
  }

  const takePhoto = () => {
    if (!videoRef.current) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 720
    const context = canvas.getContext('2d')
    if (!context) {
      setError('拍照失败，请重试。')
      return
    }

    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
    const imageData = canvas.toDataURL('image/jpeg', 0.92)
    setCapturedImage(imageData)
    setResult(null)
    setStatus('照片已捕获，点击“预测未来职业”')
  }

  const predict = async () => {
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
          participant_name: trimmedParticipantName,
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

      const displayName = trimmedParticipantName
      const reviewItem: ReviewItem = {
        predictionId: data.prediction_id,
        name: displayName,
        profession: data.profession,
        imageUrl: data.generated_image_url,
        capturedImageUrl: capturedImage ?? undefined,
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

  useEffect(() => {
    if (!isPredicting || !pendingResult || !pendingReviewItem) {
      return
    }
    if (loadingStoryIndex < LOADING_STORY.length - 1) {
      return
    }

    const revealTimer = window.setTimeout(() => {
      setResult(pendingResult)
      setReviewList((prev) => [
        pendingReviewItem,
        ...prev.filter((item) => item.predictionId !== pendingReviewItem.predictionId),
      ])
      setPendingResult(null)
      setPendingReviewItem(null)
      setIsPredicting(false)
      setStatus('预测完成，艾小语已带回未来照片。')
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
      setLoginError(authError instanceof Error ? authError.message : '登录失败，请重试。')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const logout = () => {
    stopWarpSound()
    setToken('')
    setResult(null)
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
    try {
      const loadImage = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('图片加载失败'))
          image.src = src
        })

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
          const nowImg = await loadImage(item.capturedImageUrl)
          const futureImg = await loadImage(item.imageUrl)
          context.drawImage(nowImg, x + 8, y + 8, halfW, imgH)
          context.drawImage(futureImg, x + 8 + halfW + 6, y + 8, halfW, imgH)
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
          const image = await loadImage(item.imageUrl)
          context.drawImage(image, x + 8, y + 8, cardWidth - 16, cardWidth - 16)

          context.fillStyle = '#f2fdff'
          context.font = 'bold 22px Segoe UI, sans-serif'
          context.fillText(item.name, x + 12, y + cardWidth + 24)
          context.fillStyle = '#9ddffc'
          context.font = '18px Segoe UI, sans-serif'
          context.fillText(item.profession, x + 12, y + cardWidth + 52)
        }
      }

      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = `future-wall-${new Date().toISOString().slice(0, 10)}.png`
      link.click()
      setStatus('纪念墙已导出到本地。')
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败，请重试。')
    } finally {
      setIsExportingWall(false)
    }
  }

  const loadingStoryText = LOADING_STORY[loadingStoryIndex]
  const yearMatch = loadingStoryText.match(/(20\d{2})年/)
  const activeYear = yearMatch ? Number(yearMatch[1]) : null
  const openAdminPage = () => {
    window.location.hash = '#/admin'
  }
  const openMainPage = () => {
    window.location.hash = '#/'
  }

  if (!token) {
    return (
      <main className="container">
        <section className="login-panel">
          <h1>408班十岁礼登录</h1>
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
      </main>
    )
  }

  return (
    <main className="container">
      <button className="logout-corner" onClick={logout}>退出登录</button>
      <button className="admin-nav-corner" onClick={viewMode === 'admin' ? openMainPage : openAdminPage}>
        {viewMode === 'admin' ? '返回活动页面' : '管理员页面'}
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
          <header className="hero-header">
            <div className="hero-badge">英特外国语小学 408班</div>
            <div className="bee-row" aria-hidden="true">
              <span>🐝</span>
              <span>🐝</span>
              <span>🐝</span>
            </div>
            <h1>艾小语时空隧道 · 未来职业预测</h1>
            <p>🎉 十岁礼特别环节：408班大蜜蜂勇敢出发，一起预测闪闪发光的未来职业</p>
          </header>

          <section className="workspace-panel">
            <section className="camera-panel">
              <div className="camera-frame">
                {capturedImage ? (
                  <img src={capturedImage} alt="captured" className="preview" />
                ) : (
                  <video ref={videoRef} autoPlay playsInline muted className="preview" />
                )}
              </div>

              <div className="controls">
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
                  <button onClick={startCamera}>启动时空镜头</button>
                  <button onClick={stopCamera} disabled={!isCameraOn}>
                    关闭时空镜头
                  </button>
                  <button onClick={takePhoto} disabled={!isCameraOn}>
                    定格当前时空
                  </button>
                  <button onClick={predict} disabled={isPredicting || !capturedImage || !trimmedParticipantName || !isNameValid}>
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
            <p className="review-subtitle">英特外国语小学408班 · 大蜜蜂十岁礼纪念墙</p>
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
              {wallFocusMode && reviewList.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSlideshowIndex(0); setSlideshowMode(true) }}
                >
                  ▶ 循环播放
                </button>
              )}
            </div>

            {reviewList.length === 0 ? (
              <p className="review-empty">完成预测后，照片会展示在这里，方便全班一起回顾。</p>
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
                    <p className="review-name">{item.name}</p>
                    <p className="review-profession">{item.profession}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
