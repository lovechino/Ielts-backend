
-- Seed shop items
INSERT OR REPLACE INTO shop_items (id, name, description, item_type, sub_type, rarity, price_coins, price_gems, image_url, is_active)
VALUES 
('frame_1', 'Khung Gỗ Basic', 'Khung gỗ tròn tinh tế bao quanh avatar.', 'frame', 'static', 'common', 500, 0, 'https://cdn-icons-png.flaticon.com/512/11488/11488182.png', 1),
('frame_2', 'Hào Quang Rực Rỡ', 'Khung hào quan lấp lánh cực hiếm.', 'frame', 'animated', 'epic', 5000, 50, 'https://cdn-icons-png.flaticon.com/512/11502/11502424.png', 1),
('avatar_1', 'Mèo Phi Hành Gia', 'Avatar tĩnh siêu đáng yêu.', 'avatar', 'static', 'common', 1000, 0, 'https://avatar.iran.liara.run/public/3', 1),
('avatar_2', 'Rồng Thần Chớp Nhoáng', 'Avatar động cực ngầu.', 'avatar', 'animated', 'legendary', 10000, 100, 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzBxdmZ6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6Z3R6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/Lp71UqhxCiaf6/giphy.gif', 1);
