export function imageBase64(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) return Promise.reject(new Error('PNG или JPEG до 2 MB.'))
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Файлът не може да бъде прочетен.')); reader.onload = () => { const value = String(reader.result); resolve(value.slice(value.indexOf(',') + 1)) }; reader.readAsDataURL(file) })
}
