import type { Language, Product } from '../types'
import { normalizeIndianMobile } from './indian-mobile'

export type InterestLine = {
  product: Pick<Product, 'id' | 'vendor_id' | 'name_en' | 'name_kn' | 'selling_price' | 'image_url' | 'category'>
  quantity: number
}

export function validateInterest(name: string, phone: string, lines: InterestLine[]) {
  const cleanName = name.trim()

  if (cleanName.length < 2 || cleanName.length > 100) {
    return 'name'
  }
  if (!normalizeIndianMobile(phone)) {
    return 'phone'
  }
  if (lines.length < 1 || lines.length > 30) {
    return 'items'
  }
  if (lines.some(({ quantity }) => !Number.isInteger(quantity) || quantity < 1 || quantity > 99)) {
    return 'quantity'
  }
  const vendorId = lines[0]?.product.vendor_id
  if (!vendorId || lines.some(({ product }) => product.vendor_id !== vendorId)) {
    return 'vendor'
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
