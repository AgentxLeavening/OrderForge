import { describe, it, expect } from 'vitest'
import { generateInvoicePdf } from '../lib/generateInvoicePdf'

describe('generateInvoicePdf', () => {
  it('generates a non-empty PDF buffer', async () => {
    const pdf = await generateInvoicePdf({
      invoiceNumber: 'INV-TEST',
      businessName: 'Test Shop',
      ownerName: 'Owner',
      clientName: 'Client A',
      clientEmail: 'client@example.com',
      createdAt: '2026-09-01',
      dueDate: '2026-09-10',
      lineItems: [
        { id: '1', description: 'Test item', quantity: 2, unit_price: 10 },
      ],
      notes: 'Thanks!',
      taxRate: 10,
    } as any)

    expect(pdf).toBeDefined()
    // pdf-lib returns Uint8Array or ArrayBuffer; check length
    const len = (pdf as ArrayBuffer).byteLength || (pdf as Uint8Array).length
    expect(len).toBeGreaterThan(0)
  })
})
