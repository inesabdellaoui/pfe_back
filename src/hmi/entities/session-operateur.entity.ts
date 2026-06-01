import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'session_operateur', schema: 'public' })
export class SessionOperateur {

  @PrimaryGeneratedColumn()
  id_session: number;

  @Column()
  id_operateur: number;

  @Column({ default: () => 'NOW()' })
  heure_debut: Date;

  @Column({ nullable: true })
  heure_fin: Date;

  @Column({ default: 0 })
  nb_inspections: number;

  @Column({ default: 0 })
  nb_io: number;

  @Column({ default: 0 })
  nb_nio: number;

  @Column({ nullable: true })
  machine_id: string;

  @Column({ nullable: true })
  notes: string;
}