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
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
const REVIEW_STORAGE_KEY = 'futurepred-review-wall'
const AUTH_STORAGE_KEY = 'futurepred-access-token'
const NAME_PATTERN = /^[A-Za-z\u4e00-\u9fff]+(?: [A-Za-z\u4e00-\u9fff]+)*$/
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

  const trimmedParticipantName = participantName.trim()
  const isNameValid = NAME_PATTERN.test(trimmedParticipantName)

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
    }, 1050)

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
    }, 650)

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

  const loadingStoryText = LOADING_STORY[loadingStoryIndex]
  const yearMatch = loadingStoryText.match(/(20\d{2})年/)
  const activeYear = yearMatch ? Number(yearMatch[1]) : null

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
            {error && <p className="error">{error}</p>}
          </div>
        </section>

        <section className="result-panel result-panel-inline">
          <h2>{result ? `未来职业结果：${result.profession}` : '时空隧道 · 未来职业结果区'}</h2>
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
            <>
              <img src={result.generated_image_url} alt={result.profession} className="result-image" />
            </>
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
        </section>
      </section>

      <section className="review-panel">
        <div className="review-header">
          <h2>未来职业回顾墙</h2>
          <span>{reviewList.length} / 28</span>
        </div>
        <p className="review-subtitle">英特外国语小学408班 · 大蜜蜂十岁礼纪念墙</p>

        {reviewList.length === 0 ? (
          <p className="review-empty">完成预测后，照片会展示在这里，方便全班一起回顾。</p>
        ) : (
          <div className="review-grid">
            {reviewList.map((item) => (
              <article key={item.predictionId} className="review-card">
                <img src={item.imageUrl} alt={item.name} className="review-image" />
                <p className="review-name">{item.name}</p>
                <p className="review-profession">{item.profession}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
