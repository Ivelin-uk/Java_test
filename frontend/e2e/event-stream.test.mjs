import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventStreamParser } from '../src/workspace/eventStream.ts'

test('SSE handles CRLF split across chunks without dispatching a frame early', () => {
  const events = []
  const parser = createEventStreamParser((event, data) => events.push({ event, data }))
  parser.push('event: changed\r')
  parser.push('\ndata: {"conversationId":42}\r')
  assert.deepEqual(events, [])
  parser.push('\n\r')
  parser.push('\n')
  assert.deepEqual(events, [{ event: 'changed', data: '{"conversationId":42}' }])
})

test('SSE accepts every chunk boundary, UTF-8 text, multiline data and comments', () => {
  const events = []
  const parser = createEventStreamParser((event, data) => events.push({ event, data }))
  const frames = ': keepalive\n\nevent: changed\ndata: Здравей\ndata: свят\n\ndata: done\n\n'
  for (const character of frames) parser.push(character)
  assert.deepEqual(events, [{ event: 'changed', data: 'Здравей\nсвят' }, { event: 'message', data: 'done' }])
})

test('SSE accepts standalone CR delimiters and discards incomplete frames on disconnect', () => {
  const events = []
  const parser = createEventStreamParser((event, data) => events.push({ event, data }))
  parser.push('data:first\r\rdata:unfinished\n')
  parser.finish()
  assert.deepEqual(events, [{ event: 'message', data: 'first' }])
})

test('SSE bounds an unterminated frame', () => {
  const parser = createEventStreamParser(() => {})
  assert.throws(() => parser.push('data:' + 'x'.repeat(1024 * 1024)), /Невалиден поток/)
})
