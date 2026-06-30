import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private formatCart(cart: any) {
    if (!cart) return null;

    const items = (cart.items || []).map((item: any) => {
      const vendorProduct = item.vendorProduct;
      const product = vendorProduct.product;

      // Extract image fallback from attributes
      let image: string | null = null;
      if (vendorProduct.attributes && typeof vendorProduct.attributes === 'object') {
        const attrs = vendorProduct.attributes as Record<string, any>;
        if (Array.isArray(attrs.images) && attrs.images.length > 0) {
          image = attrs.images[0];
        } else if (typeof attrs.image === 'string') {
          image = attrs.image;
        }
      }

      const price = Number(item.unitPrice);
      const shippingFee = Number((vendorProduct.attributes as any)?.shippingFee || 0);

      return {
        id: item.id,
        itemId: item.vendorProductId,
        title: product.name,
        price,
        quantity: item.quantity,
        image,
        shippingFee,
        stock: vendorProduct.stock,
      };
    });

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingTotal = items.reduce((sum, item) => sum + item.shippingFee, 0);
    const total = subtotal + shippingTotal;

    return {
      id: cart.id,
      items,
      itemCount,
      subtotal,
      shippingTotal,
      total,
    };
  }

  async getOrCreateCart(userId: string) {
    let cart = await this.prisma.cart.findUnique({
      where: {
        one_active_cart_per_user: {
          userId,
          status: 'ACTIVE',
        },
      },
      include: {
        items: {
          include: {
            vendorProduct: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          userId,
          status: 'ACTIVE',
        },
        include: {
          items: {
            include: {
              vendorProduct: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });
    }

    return this.formatCart(cart);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Get or create active cart
      let cart = await tx.cart.findUnique({
        where: {
          one_active_cart_per_user: {
            userId,
            status: 'ACTIVE',
          },
        },
      });

      if (!cart) {
        cart = await tx.cart.create({
          data: {
            userId,
            status: 'ACTIVE',
          },
        });
      }

      // 2. Fetch vendor product to check stock and price
      const vendorProduct = await tx.vendorProduct.findUnique({
        where: { id: dto.vendorProductId },
      });

      if (!vendorProduct) {
        throw new NotFoundException(`Vendor product listing ${dto.vendorProductId} not found`);
      }

      if (!vendorProduct.isActive) {
        throw new BadRequestException('This product listing is no longer active');
      }

      // 3. Check existing item in cart
      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_vendorProductId: {
            cartId: cart.id,
            vendorProductId: dto.vendorProductId,
          },
        },
      });

      const newQuantity = existingItem ? existingItem.quantity + dto.quantity : dto.quantity;

      if (vendorProduct.stock < newQuantity) {
        throw new BadRequestException(`Insufficient stock. Only ${vendorProduct.stock} items available`);
      }

      // 4. Upsert cart item
      await tx.cartItem.upsert({
        where: {
          cartId_vendorProductId: {
            cartId: cart.id,
            vendorProductId: dto.vendorProductId,
          },
        },
        update: {
          quantity: newQuantity,
          unitPrice: vendorProduct.price,
        },
        create: {
          cartId: cart.id,
          vendorProductId: dto.vendorProductId,
          quantity: dto.quantity,
          unitPrice: vendorProduct.price,
        },
      });

      // 5. Return updated cart
      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              vendorProduct: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

      return this.formatCart(updatedCart);
    });
  }

  async updateQuantity(userId: string, vendorProductId: string, quantity: number) {
    if (quantity < 1) {
      return this.removeItem(userId, vendorProductId);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Find the active cart
      const cart = await tx.cart.findUnique({
        where: {
          one_active_cart_per_user: {
            userId,
            status: 'ACTIVE',
          },
        },
      });

      if (!cart) {
        throw new NotFoundException('Active cart not found');
      }

      // 2. Fetch vendor product to check stock
      const vendorProduct = await tx.vendorProduct.findUnique({
        where: { id: vendorProductId },
      });

      if (!vendorProduct) {
        throw new NotFoundException(`Vendor product listing ${vendorProductId} not found`);
      }

      if (vendorProduct.stock < quantity) {
        throw new BadRequestException(`Insufficient stock. Only ${vendorProduct.stock} items available`);
      }

      // 3. Update item quantity
      const cartItem = await tx.cartItem.findUnique({
        where: {
          cartId_vendorProductId: {
            cartId: cart.id,
            vendorProductId,
          },
        },
      });

      if (!cartItem) {
        throw new NotFoundException('Item not found in cart');
      }

      await tx.cartItem.update({
        where: { id: cartItem.id },
        data: {
          quantity,
          unitPrice: vendorProduct.price,
        },
      });

      // 4. Return updated cart
      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              vendorProduct: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

      return this.formatCart(updatedCart);
    });
  }

  async removeItem(userId: string, vendorProductId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: {
          one_active_cart_per_user: {
            userId,
            status: 'ACTIVE',
          },
        },
      });

      if (!cart) {
        throw new NotFoundException('Active cart not found');
      }

      const cartItem = await tx.cartItem.findUnique({
        where: {
          cartId_vendorProductId: {
            cartId: cart.id,
            vendorProductId,
          },
        },
      });

      if (cartItem) {
        await tx.cartItem.delete({
          where: { id: cartItem.id },
        });
      }

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              vendorProduct: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

      return this.formatCart(updatedCart);
    });
  }

  async clearCart(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: {
          one_active_cart_per_user: {
            userId,
            status: 'ACTIVE',
          },
        },
      });

      if (cart) {
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id },
        });
      }

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart?.id || '' },
        include: {
          items: {
            include: {
              vendorProduct: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

      return this.formatCart(updatedCart);
    });
  }
}
