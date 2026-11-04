export function normalizeIndianMobile(value: string) {
  const phone = value.trim()
  if (!/^\+?[0-9(][0-9() -]{8,22}$/.test(phone)) return null

  const digits = phone.replace(/\D/g, '')
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (!/^[6-9]\d{9}$/.test(mobile)) return null

  return `+91${mobile}`
}
