import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

type LineItem = {
  description: string
  quantity: number
  unit_price: number
}

type InvoiceData = {
  invoiceNumber: string
  businessName: string
  ownerName: string
  clientName?: string
  clientEmail?: string
  createdAt: string
  dueDate?: string
  lineItems: LineItem[]
  notes?: string
  taxRate?: number
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // US Letter
  const { width, height } = page.getSize()

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica)

  const INDIGO = rgb(0.31, 0.27, 0.9)
  const BLACK = rgb(0.07, 0.09, 0.15)
  const GRAY = rgb(0.42, 0.45, 0.50)
  const LIGHT = rgb(0.95, 0.96, 1.0)
  const WHITE = rgb(1, 1, 1)

  let y = height - 60

  // Header background
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: INDIGO })

  // Business name
  page.drawText(data.businessName || 'My Shop', {
    x: 48, y: height - 52,
    font: fontBold, size: 26, color: WHITE
  })

  // INVOICE label
  page.drawText('INVOICE', {
    x: width - 130, y: height - 52,
    font: fontBold, size: 22, color: WHITE
  })

  // Invoice number
  page.drawText(data.invoiceNumber, {
    x: width - 180, y: height - 78,
    font: fontRegular, size: 11, color: rgb(0.8, 0.8, 1.0)
  })

  y = height - 140

  // Billing info row
  // From
  page.drawText('FROM', { x: 48, y, font: fontBold, size: 9, color: GRAY })
  y -= 18
  page.drawText(data.ownerName, { x: 48, y, font: fontBold, size: 12, color: BLACK })
  y -= 16
  page.drawText(data.businessName || '', { x: 48, y, font: fontRegular, size: 11, color: GRAY })

  // To
  let billY = height - 140
  page.drawText('BILL TO', { x: 260, y: billY, font: fontBold, size: 9, color: GRAY })
  billY -= 18
  page.drawText(data.clientName || 'Customer', { x: 260, y: billY, font: fontBold, size: 12, color: BLACK })
  billY -= 16
  if (data.clientEmail) {
    page.drawText(data.clientEmail, { x: 260, y: billY, font: fontRegular, size: 11, color: GRAY })
  }

  // Dates
  let dateY = height - 140
  page.drawText('DATE', { x: 440, y: dateY, font: fontBold, size: 9, color: GRAY })
  dateY -= 18
  page.drawText(data.createdAt, { x: 440, y: dateY, font: fontRegular, size: 11, color: BLACK })
  dateY -= 20
  if (data.dueDate) {
    page.drawText('DUE DATE', { x: 440, y: dateY, font: fontBold, size: 9, color: GRAY })
    dateY -= 18
    page.drawText(data.dueDate, { x: 440, y: dateY, font: fontRegular, size: 11, color: BLACK })
  }

  y = height - 240

  // Divider
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 1, color: rgb(0.9, 0.9, 0.95) })
  y -= 20

  // Line items header
  page.drawRectangle({ x: 48, y: y - 8, width: width - 96, height: 28, color: LIGHT })
  page.drawText('DESCRIPTION', { x: 56, y: y + 4, font: fontBold, size: 9, color: GRAY })
  page.drawText('QTY', { x: 360, y: y + 4, font: fontBold, size: 9, color: GRAY })
  page.drawText('UNIT PRICE', { x: 410, y: y + 4, font: fontBold, size: 9, color: GRAY })
  page.drawText('TOTAL', { x: 524, y: y + 4, font: fontBold, size: 9, color: GRAY })
  y -= 28

  // Line items
  let subtotal = 0
  for (const item of data.lineItems) {
    const lineTotal = item.quantity * item.unit_price
    subtotal += lineTotal

    page.drawText(item.description, { x: 56, y, font: fontRegular, size: 11, color: BLACK, maxWidth: 280 })
    page.drawText(String(item.quantity), { x: 368, y, font: fontRegular, size: 11, color: BLACK })
    page.drawText(`$${item.unit_price.toFixed(2)}`, { x: 410, y, font: fontRegular, size: 11, color: BLACK })
    page.drawText(`$${lineTotal.toFixed(2)}`, { x: 524, y, font: fontRegular, size: 11, color: BLACK })

    y -= 24

    // Light divider between items
    page.drawLine({ start: { x: 48, y: y + 8 }, end: { x: width - 48, y: y + 8 }, thickness: 0.5, color: rgb(0.93, 0.93, 0.96) })
  }

  y -= 20

  // Totals box
  const taxAmount = subtotal * ((data.taxRate || 0) / 100)
  const total = subtotal + taxAmount

  const totalsX = 390
  page.drawRectangle({ x: totalsX - 12, y: y - 70, width: width - totalsX - 36, height: 90, color: LIGHT, borderRadius: 4 })

  page.drawText('Subtotal', { x: totalsX, y, font: fontRegular, size: 11, color: GRAY })
  page.drawText(`$${subtotal.toFixed(2)}`, { x: 524, y, font: fontRegular, size: 11, color: BLACK })
  y -= 22

  if (data.taxRate) {
    page.drawText(`Tax (${data.taxRate}%)`, { x: totalsX, y, font: fontRegular, size: 11, color: GRAY })
    page.drawText(`$${taxAmount.toFixed(2)}`, { x: 524, y, font: fontRegular, size: 11, color: BLACK })
    y -= 22
  }

  page.drawLine({ start: { x: totalsX, y: y + 8 }, end: { x: width - 48, y: y + 8 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.9) })
  y -= 8

  page.drawText('Total', { x: totalsX, y, font: fontBold, size: 13, color: BLACK })
  page.drawText(`$${total.toFixed(2)}`, { x: 516, y, font: fontBold, size: 14, color: INDIGO })

  // Notes
  if (data.notes) {
    y -= 60
    page.drawText('NOTES', { x: 48, y, font: fontBold, size: 9, color: GRAY })
    y -= 16
    page.drawText(data.notes, { x: 48, y, font: fontRegular, size: 11, color: GRAY, maxWidth: 400 })
  }

  // Footer
  page.drawText('Thank you for your business!', {
    x: 48, y: 40,
    font: fontRegular, size: 10, color: GRAY
  })

  return doc.save()
}