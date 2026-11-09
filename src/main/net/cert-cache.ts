import type { Certificate, Session } from 'electron'
import type { CertInfo } from '@shared/types'

interface Entry {
  cert: Certificate
  ok: boolean
}

/** Remembers the certificate seen per host so the padlock popup can show details. In-memory only. */
export class CertCache {
  private map = new Map<string, Entry>()
  private static MAX = 300

  /** Install a verify proc that records the cert and defers to Chromium's own verdict (-3). */
  attach(ses: Session): void {
    ses.setCertificateVerifyProc((request, callback) => {
      this.record(request.hostname, request.certificate, request.verificationResult === 'net::OK')
      callback(-3)
    })
  }

  record(hostname: string, cert: Certificate, ok: boolean): void {
    this.map.delete(hostname)
    this.map.set(hostname, { cert, ok })
    if (this.map.size > CertCache.MAX) {
      const first = this.map.keys().next().value
      if (first !== undefined) this.map.delete(first)
    }
  }

  isOk(hostname: string): boolean | null {
    return this.map.get(hostname)?.ok ?? null
  }

  info(hostname: string): CertInfo | null {
    const e = this.map.get(hostname)
    if (!e) return null
    const c = e.cert
    return {
      hostname,
      secure: e.ok,
      subject: c.subjectName,
      issuer: c.issuerName,
      validFrom: c.validStart * 1000,
      validTo: c.validExpiry * 1000,
      fingerprint: c.fingerprint,
      serialNumber: c.serialNumber
    }
  }

  clear(): void {
    this.map.clear()
  }
}
