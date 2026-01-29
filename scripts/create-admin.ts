import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const SALT_ROUNDS = 12;

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function createAdmin(): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Create Admin User\n');

  const email = await prompt('Email: ');
  const password = await prompt('Password: ');
  const confirmPassword = await prompt('Confirm Password: ');

  if (password !== confirmPassword) {
    console.error('Passwords do not match');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('admin_users')
    .insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      role: 'admin'
    })
    .select('id, email, role, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      console.error('An admin with this email already exists');
    } else {
      console.error('Error creating admin:', error.message);
    }
    process.exit(1);
  }

  console.log('\nAdmin user created successfully!');
  console.log(`  ID: ${data.id}`);
  console.log(`  Email: ${data.email}`);
  console.log(`  Role: ${data.role}`);
  console.log(`  Created: ${data.created_at}`);
}

createAdmin().catch(console.error);
