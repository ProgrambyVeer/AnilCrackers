import type { Language, Product } from '../types'

export type InterestLine = {
  product: Pick<Product, 'id' | 'name_en' | 'name_kn' | 'selling_price' | 'image_url' | 'category'>
  quantity: number
}

export function validateInterest(name: string, phone: string, lines: InterestLine[]) {
  const cleanName = name.trim()
  const digits = phone.replace(/\D/g, '')
  const phoneDigits = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits

  if (cleanName.length < 2 || cleanName.length > 100) {
    return 'name'
  }
  if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
    return 'phone'
  }
  if (lines.length < 1 || lines.length > 30) {
    return 'items'
  }
  if (lines.some(({ quantity }) => !Number.isInteger(quantity) || quantity < 1 || quantity > 99)) {
    return 'quantity'
  }
  return null
}

export function makeWhatsAppMessage(
  name: string,
  phone: string,
  lines: InterestLine[],
  language: Language,
  referenceCode?: string,
) {
  const items = lines.map(({ product, quantity }, index) => {
    const productName = language === 'kn' ? product.name_kn || product.name_en : product.name_en
    const quantityLabel = language === 'kn' ? 'ಪ್ರಮಾಣ' : 'Quantity'
    return `${index + 1}. ${productName} — ${quantityLabel}: ${quantity}`
  })
  const message = language === 'kn'
    ? [
        'ನಮಸ್ಕಾರ! ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು.',
        '',
        `ನನ್ನ ಹೆಸರು ${name}.`,
        `ನನ್ನ ದೂರವಾಣಿ ಸಂಖ್ಯೆ ${phone}.`,
        '',
        'ನನಗೆ ಈ ಪಟಾಕಿಗಳ ಬಗ್ಗೆ ಆಸಕ್ತಿ ಇದೆ:',
        ...items,
        ...(referenceCode ? ['', `ವಿಚಾರಣೆ ಸಂಖ್ಯೆ: ${referenceCode}`] : []),
        '',
        'ದಯವಿಟ್ಟು ಲಭ್ಯತೆ ಮತ್ತು ವಿವರಗಳನ್ನು ನೇರವಾಗಿ ದೃಢೀಕರಿಸಿ.',
        'ಧನ್ಯವಾದಗಳು!',
      ]
    : [
        'Hello! Happy Deepavali.',
        '',
        `My name is ${name}.`,
        `My phone number is ${phone}.`,
        '',
        "I'm interested in the following crackers:",
        ...items,
        ...(referenceCode ? ['', `Enquiry reference: ${referenceCode}`] : []),
        '',
        'Please confirm availability and the details directly with me.',
        '',
        'Thank you!',
      ]

  return message.join('\n')
}

export function makeWhatsAppUrl(
  number: string,
  name: string,
  phone: string,
  lines: InterestLine[],
  language: Language,
  referenceCode?: string,
) {
  const message = makeWhatsAppMessage(name, phone, lines, language, referenceCode)
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}
