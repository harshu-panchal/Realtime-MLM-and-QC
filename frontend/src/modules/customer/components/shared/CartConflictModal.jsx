import React from "react";
import Modal from "@shared/components/ui/Modal";
import Button from "@shared/components/ui/Button";
import { useCart } from "../../context/CartContext";

const LABELS = {
  quick_commerce: "Quick",
  ecommerce: "ShopAll",
};

// Global conflict prompt for the cart-mixing guard: a cart can only hold
// items from one business type (Quick Commerce or E-commerce) at a time.
// Mounted once in CustomerLayout so it's available regardless of which page
// triggered the add-to-cart action.
const CartConflictModal = () => {
  const { cartConflict, resolveCartConflict } = useCart() || {};

  if (!cartConflict) return null;

  const currentLabel = LABELS[cartConflict.cartBusinessType] || "your current store type";
  const incomingLabel = LABELS[cartConflict.incomingBusinessType] || "this store type";

  return (
    <Modal
      isOpen={Boolean(cartConflict)}
      onClose={() => resolveCartConflict("cancel")}
      title="Different store type"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => resolveCartConflict("cancel")}>
            Keep current cart
          </Button>
          <Button onClick={() => resolveCartConflict("replace")}>
            Clear cart & add
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600 leading-relaxed">
        Your cart has items from <strong>{currentLabel}</strong>. Adding this item from{" "}
        <strong>{incomingLabel}</strong> will clear your current cart. Continue?
      </p>
    </Modal>
  );
};

export default CartConflictModal;
