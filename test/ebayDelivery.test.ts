import { describe, it, expect } from 'vitest'
import { parseTradingGetOrders } from '../lib/integrations/ebay'

// Shapes trimmed from a real production GetOrders response (2026-09-15),
// buyer details removed. Delivery drives orders to Complete, so the parser is
// pinned against the cases that would complete an order too early.

const pkg = (delivered: string | null) => `<ShippingPackageInfo>
  <EstimatedDeliveryTimeMax>2026-07-02T07:00:00.000Z</EstimatedDeliveryTimeMax>
  ${delivered ? `<ActualDeliveryTime>${delivered}</ActualDeliveryTime>` : ''}
</ShippingPackageInfo>`

const order = (id: string, ...packages: string[]) => `<Order>
  <OrderID>${id}</OrderID>
  <OrderStatus>Completed</OrderStatus>
  <ShippingServiceSelected>${packages.join('')}</ShippingServiceSelected>
  <TransactionArray><Transaction>
    <OrderLineItemID>123-456</OrderLineItemID>
    <ShippingServiceSelected>${packages.join('')}</ShippingServiceSelected>
  </Transaction></TransactionArray>
  <ShippedTime>2026-06-23T14:49:50.000Z</ShippedTime>
</Order>`

const response = (orders: string[], { ack = 'Success', hasMore = false } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<GetOrdersResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>${ack}</Ack>
  <HasMoreOrders>${hasMore}</HasMoreOrders>
  <OrderArray>${orders.join('')}</OrderArray>
</GetOrdersResponse>`

describe('parseTradingGetOrders', () => {
  it('marks an order with ActualDeliveryTime as delivered', () => {
    const r = parseTradingGetOrders(response([order('12-34567-89012', pkg('2026-06-29T10:52:11.000Z'))]))
    expect(r.deliveredOrderIds).toEqual(['12-34567-89012'])
    expect(r.ack).toBe('Success')
    expect(r.hasMore).toBe(false)
  })

  it('does not mark an in-transit order delivered', () => {
    const r = parseTradingGetOrders(response([order('12-00000-00001', pkg(null))]))
    expect(r.deliveredOrderIds).toEqual([])
  })

  it('requires every package delivered on a multi-package order', () => {
    const partial = order('12-00000-00002', pkg('2026-06-29T10:52:11.000Z'), pkg(null))
    const full = order('12-00000-00003', pkg('2026-06-29T10:52:11.000Z'), pkg('2026-06-30T09:00:00.000Z'))
    expect(parseTradingGetOrders(response([partial, full])).deliveredOrderIds).toEqual(['12-00000-00003'])
  })

  it('does not treat an order with no package info as delivered', () => {
    const bare = `<Order><OrderID>12-00000-00004</OrderID><OrderStatus>Active</OrderStatus></Order>`
    expect(parseTradingGetOrders(response([bare])).deliveredOrderIds).toEqual([])
  })

  it('keeps orders separate so one delivery cannot leak into the next order', () => {
    const r = parseTradingGetOrders(response([
      order('12-00000-00005', pkg(null)),
      order('12-00000-00006', pkg('2026-07-06T15:14:59.000Z')),
    ]))
    expect(r.deliveredOrderIds).toEqual(['12-00000-00006'])
  })

  it('reports pagination and failures', () => {
    expect(parseTradingGetOrders(response([], { hasMore: true })).hasMore).toBe(true)
    const failed = parseTradingGetOrders(
      `<GetOrdersResponse><Ack>Failure</Ack><Errors><LongMessage>Invalid token.</LongMessage></Errors></GetOrdersResponse>`
    )
    expect(failed.ack).toBe('Failure')
    expect(failed.errors).toEqual(['Invalid token.'])
  })
})
