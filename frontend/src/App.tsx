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
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

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
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then((res) => res.json())
      .then((data) => setRemaining(data.remaining))
      .catch(() => setRemaining(null))
  }, [])

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_name: participantName.trim(),
          image_data: capturedImage,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail ?? '预测失败，请重试。')
      }

      setResult(data)
      setRemaining(data.total_professions - data.profession_index)
      setStatus('预测完成')
    } catch (predictError) {
      setError(
        predictError instanceof Error ? predictError.message : '请求失败，请稍后再试。',
      )
      setStatus('预测失败')
    } finally {
      setIsPredicting(false)
    }
  }

  return (
    <main className="container">
      <header>
        <h1>AI 未来职业预测</h1>
        <p>正在预测未来职业，结果为高端职业方向（28人唯一不重复）</p>
        <p className="remaining">
          {remaining === null ? '剩余名额：读取中...' : `剩余名额：${remaining}`}
        </p>
      </header>

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

      {result && (
        <section className="result-panel">
          <h2>预测结果：{result.profession}</h2>
          <p>
            分配序号：{result.profession_index}/{result.total_professions}
          </p>
          <img src={result.generated_image_url} alt={result.profession} className="result-image" />
        </section>
      )}
    </main>
  )
}

export default App
