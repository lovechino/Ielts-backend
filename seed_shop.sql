INSERT INTO shop_items (id, name, description, item_type, sub_type, rarity, price_coins, price_gems, metadata, is_active)
VALUES (
  '12345678-abcd-1234-abcd-1234567890ab',
  'Extra Course Slot',
  'Mở rộng thêm 1 Khóa học / Thư mục từ vựng trong Word Vault của bạn.',
  'expansion',
  'static',
  'epic',
  500,
  0,
  '{"effect":"extra_course_slot","value":1}',
  1
)
ON CONFLICT DO NOTHING;
