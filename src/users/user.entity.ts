import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum UserRole {
  OPERATRICE_BMW = 'operatrice_bmw',
  OPERATRICE_RR = 'operatrice_rr',
  RESPONSABLE_QUALITE = 'responsable_qualite',
  ADMIN = 'admin',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nom: string;

  @Column()
  prenom: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.OPERATRICE_BMW,
  })
  role: UserRole;

  @Column({ name: 'id_client', nullable: true })
  idClient: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'last_login', nullable: true })
  lastLogin: Date;
}