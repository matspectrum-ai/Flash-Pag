import { useEffect, useState } from 'react'
import * as QRCode from 'qrcode'

type MFAQRCodeProps = {
  uri: string
  alt: string
}

export function MFAQRCode({ uri, alt }: MFAQRCodeProps) {
  const [dataURL, setDataURL] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setDataURL('')
    setError('')
    const value = uri.trim()
    if (!value.startsWith('otpauth://totp/')) {
      setError('A configuração recebida do autenticador é inválida.')
      return () => { active = false }
    }
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 2, width: 320 })
      .then((result) => { if (active) setDataURL(result) })
      .catch(() => { if (active) setError('Não foi possível gerar o QR Code desta configuração.') })
    return () => { active = false }
  }, [uri])

  if (dataURL) return <div className="mfa-qr"><img src={dataURL} alt={alt} /></div>
  return <div className="mfa-qr"><div className="mfa-qr-error">{error || 'Gerando QR Code…'}</div></div>
}
