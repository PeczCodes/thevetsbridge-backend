import { OrderStatus, ShipmentStatus } from '@prisma/client';

export interface OrderUserPayload {
  id: string;
  email?: string;
  isAdmin?: boolean;
  role?: string;
  vendorProfile?: {
    id: string;
    businessName?: string | null;
  } | null;
}

export const ORDER_ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.PAID, OrderStatus.CANCELLED],
  PAID: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  PROCESSING: [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  DELIVERED: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
  REFUNDED: [],
};

export const SHIPMENT_ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: [ShipmentStatus.PROCESSING, ShipmentStatus.CANCELLED],
  PROCESSING: [ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED],
  SHIPPED: [ShipmentStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
};
