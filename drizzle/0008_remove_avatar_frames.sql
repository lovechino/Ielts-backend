UPDATE users SET avatar_frame = NULL WHERE avatar_frame IS NOT NULL;--> statement-breakpoint
DELETE FROM user_inventory
WHERE item_id IN (
  SELECT id FROM shop_items WHERE item_type = 'frame'
);--> statement-breakpoint
UPDATE shop_items SET is_active = 0 WHERE item_type = 'frame';
