import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorkerMailer } from '../../src/mailer'
import { connect } from 'cloudflare:sockets'

vi.mock('cloudflare:sockets', () => ({
  connect: vi.fn()
}))

describe('WorkerMailer', () => {
  let mockSocket: any
  let mockReader: any
  let mockWriter: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup mock socket and reader/writer
    mockReader = {
      read: vi.fn()
    }
    mockWriter = {
      write: vi.fn()
    }
    mockSocket = {
      readable: { getReader: () => mockReader },
      writable: { getWriter: () => mockWriter },
      opened: Promise.resolve(),
      close: vi.fn()
    }

    // Setup connect mock
    ;(connect as any).mockReturnValue(mockSocket)
  })

  describe('connection', () => {
    it('should connect to SMTP server successfully', async () => {
      // Mock successful connection sequence
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('235 Authentication successful\r\n') })

      const mailer = await WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'password'
        },
        authType: ['plain', 'login']
      })

      expect(connect).toHaveBeenCalledWith(
        {
          hostname: 'smtp.example.com',
          port: 587
        },
        expect.any(Object)
      )
      expect(mailer).toBeInstanceOf(WorkerMailer)
    })

    it('should throw error on connection timeout', async () => {
      mockSocket.opened = new Promise(() => {}) // Never resolves

      await expect(WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        socketTimeoutMs: 100
      })).rejects.toThrow('Socket timeout!')
    })
  })

  describe('authentication', () => {
    it('should authenticate with PLAIN auth', async () => {
      // Mock successful connection and auth sequence
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('235 Authentication successful\r\n') })

      await WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'password'
        },
        authType: ['plain']
      })

      // Verify AUTH PLAIN command was sent
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.any(Uint8Array) // Contains base64 encoded credentials
      )
    })

    it('should throw error on auth failure', async () => {
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('535 Authentication failed\r\n') })

      await expect(WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'wrong'
        },
        authType: ['plain']
      })).rejects.toThrow('Failed to plain authentication')
    })
  })

  describe('email sending', () => {
    it('should send email successfully', async () => {
      // Mock successful connection, auth and send sequence
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('235 Authentication successful\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250 Sender OK\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250 Recipient OK\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('354 Start mail input\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250 Message accepted\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('221 Bye\r\n') })

      const mailer = await WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'password'
        },
        authType: ['plain']
      })

      await mailer.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Hello World'
      })

      // Verify email commands were sent
      expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // MAIL FROM
      expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // RCPT TO
      expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // DATA
      expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // Email content
    })

    it('should handle recipient rejection', async () => {
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('235 Authentication successful\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250 Sender OK\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('550 Recipient rejected\r\n') })

      const mailer = await WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'password'
        },
        authType: ['plain']
      })

      const sendPromise = mailer.send({
        from: 'sender@example.com',
        to: 'invalid@example.com',
        subject: 'Test Email',
        text: 'Hello World'
      })

      await expect(sendPromise).rejects.toThrow('Invalid RCPT TO')
    })
  })

  describe('close', () => {
    it('should close connection properly', async () => {
      mockReader.read
        .mockResolvedValueOnce({ value: new TextEncoder().encode('220 smtp.example.com ready\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('235 Authentication successful\r\n') })
        .mockResolvedValueOnce({ value: new TextEncoder().encode('221 Bye\r\n') })

      const mailer = await WorkerMailer.connect({
        host: 'smtp.example.com',
        port: 587,
        credentials: {
          username: 'test@example.com',
          password: 'password'
        },
        authType: ['plain']
      })

      await mailer.close()

      expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // QUIT command
      expect(mockSocket.close).toHaveBeenCalled()
    })
  })
})