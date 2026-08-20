import { pool } from "./index.js";
import { hashPassword } from "../auth.js";

export async function initDatabase() {
  try {
    console.log("🛠️ Checking & initializing database tables...");

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          username TEXT UNIQUE,
          phone TEXT,
          avatar_url TEXT,
          cover_url TEXT,
          bio TEXT,
          city TEXT,
          country TEXT,
          age INTEGER,
          gender TEXT,
          vehicle_type TEXT,
          adventure_level TEXT,
          travel_style TEXT,
          looking_for JSONB DEFAULT '[]'::jsonb,
          interests JSONB DEFAULT '[]'::jsonb,
          followers_count INTEGER DEFAULT 0 NOT NULL,
          following_count INTEGER DEFAULT 0 NOT NULL,
          trips_count INTEGER DEFAULT 0 NOT NULL,
          is_verified BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS follows (
          id SERIAL PRIMARY KEY,
          follower_id INTEGER NOT NULL REFERENCES users(id),
          following_id INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          logo_url TEXT,
          cover_url TEXT,
          type TEXT DEFAULT 'public' NOT NULL,
          members_count INTEGER DEFAULT 1 NOT NULL,
          category TEXT,
          city TEXT,
          created_by_id INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_members (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL REFERENCES groups(id),
          user_id INTEGER NOT NULL REFERENCES users(id),
          role TEXT DEFAULT 'member' NOT NULL,
          joined_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          author_id INTEGER NOT NULL REFERENCES users(id),
          content TEXT NOT NULL,
          image_url TEXT,
          video_url TEXT,
          likes_count INTEGER DEFAULT 0 NOT NULL,
          comments_count INTEGER DEFAULT 0 NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS post_likes (
          id SERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL REFERENCES posts(id),
          user_id INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
          id SERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL REFERENCES posts(id),
          author_id INTEGER NOT NULL REFERENCES users(id),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trips (
          id SERIAL PRIMARY KEY,
          creator_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          description TEXT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          start_location TEXT NOT NULL,
          destination TEXT NOT NULL,
          route_url TEXT,
          distance_km NUMERIC,
          max_riders INTEGER,
          current_riders INTEGER DEFAULT 1 NOT NULL,
          status TEXT DEFAULT 'upcoming' NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trip_members (
          id SERIAL PRIMARY KEY,
          trip_id INTEGER NOT NULL REFERENCES trips(id),
          user_id INTEGER NOT NULL REFERENCES users(id),
          joined_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          seller_id INTEGER NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          price NUMERIC NOT NULL,
          category TEXT NOT NULL,
          condition TEXT NOT NULL,
          image_urls JSONB DEFAULT '[]'::jsonb,
          location TEXT,
          is_sold BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS insurance_plans (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          provider TEXT NOT NULL,
          price_monthly NUMERIC NOT NULL,
          price_yearly NUMERIC NOT NULL,
          coverage_details JSONB DEFAULT '[]'::jsonb,
          badge TEXT,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS insurance_policies (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          plan_id INTEGER NOT NULL REFERENCES insurance_plans(id),
          policy_number TEXT NOT NULL UNIQUE,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT DEFAULT 'active' NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id SERIAL PRIMARY KEY,
          user1_id INTEGER NOT NULL REFERENCES users(id),
          user2_id INTEGER NOT NULL REFERENCES users(id),
          last_message TEXT,
          last_message_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id),
          sender_id INTEGER NOT NULL REFERENCES users(id),
          content TEXT NOT NULL,
          message_type TEXT DEFAULT 'text' NOT NULL,
          is_read BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS swipes (
          id SERIAL PRIMARY KEY,
          swiper_id INTEGER NOT NULL REFERENCES users(id),
          target_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS matches (
          id SERIAL PRIMARY KEY,
          user1_id INTEGER NOT NULL REFERENCES users(id),
          user2_id INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          type TEXT NOT NULL,
          is_read BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cart_items (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          quantity INTEGER DEFAULT 1 NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wishlist_items (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          location TEXT NOT NULL,
          image_url TEXT,
          attendees_count INTEGER DEFAULT 0 NOT NULL,
          type TEXT DEFAULT 'ride' NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          total_amount NUMERIC NOT NULL,
          status TEXT DEFAULT 'pending' NOT NULL,
          shipping_address TEXT,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );
      `);

      // Individual column migrations to guarantee schema upgrades even if tables pre-exist
      const columnMigrations = [
        "ALTER TABLE groups ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'public'",
        "ALTER TABLE groups ADD COLUMN IF NOT EXISTS city TEXT",
        "ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_by_id INTEGER DEFAULT 1",
        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtags JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS location TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_swipes_count INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_swipe_reset_at TIMESTAMP DEFAULT NOW()",
      ];

      for (const query of columnMigrations) {
        try {
          await client.query(query);
          console.log(`✅ Executed migration: ${query}`);
        } catch (mErr: any) {
          console.error(`⚠️ Migration step error for "${query}":`, mErr?.message || mErr);
        }
      }

      // Seed default demo user if not existing
      const passHash = hashPassword("password123");
      await client.query(`
        INSERT INTO users (name, email, password_hash, username, city, country, vehicle_type, adventure_level, travel_style, is_verified, bio)
        VALUES ('Alex Rider', 'rider@motohippi.com', '${passHash}', 'alex_rider', 'San Francisco', 'USA', 'BMW R1250GS', 'Advanced', 'Solo & Group', true, 'Motorcycle enthusiast and cross-country explorer 🏍️')
        ON CONFLICT (email) DO NOTHING;

        INSERT INTO groups (name, description, logo_url, cover_url, type, members_count, category, city, created_by_id)
        SELECT 'Bay Area Motorcyclists', 'The premier riding group for Bay Area riders', 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=200', 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800', 'public', 128, 'General', 'San Francisco', id
        FROM users WHERE email = 'rider@motohippi.com'
        ON CONFLICT DO NOTHING;

        INSERT INTO events (title, date, location, image_url, attendees_count, type)
        VALUES 
          ('Coastal Cruiser Rally', '2026-08-15', 'Pacific Coast Highway, CA', 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800', 42, 'rally'),
          ('Mountain Pass Adventure', '2026-08-20', 'Rocky Mountain NP, CO', 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800', 28, 'ride'),
          ('Desert Night Ride', '2026-08-28', 'Joshua Tree, CA', 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800', 19, 'night')
        ON CONFLICT DO NOTHING;
      `);

      console.log("✅ Database schema initialized and demo user seeded successfully!");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("⚠️ Database initialization notice:", err);
  }
}
