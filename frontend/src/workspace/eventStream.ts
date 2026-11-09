/** Parse SSE frames independently of how the network splits UTF-8 chunks. */
export function createEventStreamParser(onEvent: (event: string, data: string) => void) {
  let line = ''
  let skipLineFeed = false
  let event = 'message'
  let data: string[] = []
  let dataLength = 0
  const maxEventLength = 1024 * 1024

  function consumeLine() {
    if (!line) {
      if (data.length) onEvent(event, data.join('\n'))
      event = 'message'
      data = []
      dataLength = 0
    } else if (!line.startsWith(':')) {
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const rawValue = separator < 0 ? '' : line.slice(separator + 1)
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
      if (field === 'event') event = value || 'message'
      if (field === 'data') {
        data.push(value)
        dataLength += value.length + 1
      }
    }
    line = ''
  }

  return {
    push(chunk: string) {
      for (const character of chunk) {
        if (skipLineFeed && character === '\n') { skipLineFeed = false; continue }
        skipLineFeed = false
        if (character === '\n' || character === '\r') {
          consumeLine()
          skipLineFeed = character === '\r'
        } else {
          line += character
        }
        if (line.length + dataLength > maxEventLength) throw new Error('Невалиден поток от съобщения.')
      }
    },
    finish() {
      // Only a blank line completes an SSE event; a cut-off frame must be retried.
      line = ''
      data = []
      dataLength = 0
      event = 'message'
      skipLineFeed = false
    },
  }
}
