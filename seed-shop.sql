
-- Seed shop items
INSERT OR IGNORE INTO shop_items (id, name, description, item_type, sub_type, rarity, price_coins, price_gems, image_url, is_active)
VALUES 
('frame_1', 'Khung Gỗ Basic', 'Khung gỗ đơn giản cho người mới.', 'frame', 'static', 'common', 500, 0, 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png', 1),
('frame_2', 'Hào Quang Rực Rỡ', 'Khung động với hiệu ứng ánh sáng.', 'frame', 'animated', 'epic', 5000, 50, 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzBxdmZ6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o7TKIFm1pG8xV6yU8/giphy.gif', 1),
('avatar_1', 'Mèo Phi Hành Gia', 'Avatar tĩnh siêu đáng yêu.', 'avatar', 'static', 'common', 1000, 0, 'https://avatar.iran.liara.run/public/3', 1),
('avatar_2', 'Rồng Thần Chớp Nhoáng', 'Avatar động cực ngầu.', 'avatar', 'animated', 'legendary', 10000, 100, 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzBxdmZ6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/Lp71UqhxCiaf6/giphy.gif', 1);
