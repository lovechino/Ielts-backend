CREATE TABLE `speaking_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`topic` text NOT NULL,
	`part` integer NOT NULL,
	`status` text DEFAULT 'active',
	`turn_count` integer DEFAULT 0,
	`average_band` real,
	`report` text,
	`started_at` integer DEFAULT CURRENT_TIMESTAMP,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `speaking_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`transcript` text,
	`ai_response` text,
	`band_estimate` real,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `speaking_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
