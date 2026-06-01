import { Entity, PrimaryGeneratedColumn, Column,
         ManyToOne, JoinColumn } from 'typeorm';

@Entity({ name: 'operateur', schema: 'public' })
export class Operateur {

  @PrimaryGeneratedColumn()
  id_operateur: number;

  @Column({ unique: true })
  matricule: string;

  @Column()
  nom: string;

  @Column()
  prenom: string;

  @Column()
  poste: string;

  @Column({ nullable: true })
  id_client: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ nullable: true })
  date_embauche: Date;

  @Column({ default: () => 'NOW()' })
  created_at: Date;

  @Column({ default: () => 'NOW()' })
  updated_at: Date;
}