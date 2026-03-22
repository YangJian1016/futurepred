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
  const [participantName, setParticipantName] = useState('')
  const [capturedImage, setCapturedImage] = useState('')
  const [result, setResult] = useState<PredictResponse | null>(null)
  const [status, setStatus] = useState('点击“开启摄像头”开始')
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isPredicting, setIsPredicting] = useState(false)
  const [error, setError] = useState('')
  const [reviewList, setReviewList] = useState<ReviewItem[]>([])
  const [token, setToken] = useState('')
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)

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
    }
  }, [])

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
    if (!capturedImage) {
      setError('请先拍照。')
      return
    }

    setError('')
    setIsPredicting(true)
    setStatus('正在预测未来职业...')

    try {
      const response = await fetch(`${API_BASE}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participant_name: participantName.trim(),
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

      const displayName = participantName.trim() || `小朋友${data.profession_index}`

      setResult(data)
      setStatus('预测完成')
      setReviewList((prev) => [
        {
          predictionId: data.prediction_id,
          name: displayName,
          profession: data.profession,
          imageUrl: data.generated_image_url,
        },
        ...prev.filter((item) => item.predictionId !== data.prediction_id),
      ])
    } catch (predictError) {
      setError(
        predictError instanceof Error ? predictError.message : '请求失败，请稍后再试。',
      )
      setStatus('预测失败')
    } finally {
      setIsPredicting(false)
    }
  }

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
    setToken('')
    setResult(null)
    setCapturedImage('')
    setIsCameraOn(false)
    setStatus('已退出登录')
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
            {isLoggingIn ? '登录中...' : '登录并开始'}
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
        <h1>AI 未来职业预测</h1>
        <p>🎉 十岁礼特别环节：408班大蜜蜂勇敢出发，一起预测闪闪发光的未来职业</p>
      </header>

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
              placeholder="可选：输入小朋友姓名"
              value={participantName}
              onChange={(event) => setParticipantName(event.target.value)}
              maxLength={50}
            />
            <div className="button-row">
              <button onClick={startCamera}>开启摄像头</button>
              <button onClick={stopCamera} disabled={!isCameraOn}>
                关闭摄像头
              </button>
              <button onClick={takePhoto} disabled={!isCameraOn}>
                拍照
              </button>
              <button onClick={predict} disabled={isPredicting || !capturedImage}>
                {isPredicting ? '预测中...' : '预测未来职业'}
              </button>
            </div>
            <p className="status">{status}</p>
            {error && <p className="error">{error}</p>}
          </div>
        </section>

        <section className="result-panel result-panel-inline">
          <h2>{result ? `预测结果：${result.profession}` : '未来职业结果区'}</h2>
          {result ? (
            <>
              <p>
                分配序号：{result.profession_index}/{result.total_professions}
              </p>
              <img src={result.generated_image_url} alt={result.profession} className="result-image" />
            </>
          ) : (
            <div className="result-placeholder">
              <div className="result-placeholder-art" aria-hidden="true">🐝</div>
              <p>拍照并完成预测后，未来职业形象会立即展示在这里。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
