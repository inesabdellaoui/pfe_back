import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'inspection', schema: 'public' })
export class Inspection {

  @PrimaryGeneratedColumn()
  id_inspection: number;

  @Column()
  id_piece: string;

  @Column({ nullable: true })
  date_inspection: Date;

  @Column({ nullable: true })
  resultat: string;

  @Column({ type: 'numeric', nullable: true })
  confidence: number;

  @Column({ nullable: true })
  model_version: string;

  @Column({ nullable: true })
  image_path: string;

  @Column({ nullable: true })
  bbox_h: number;

  @Column({ nullable: true })
  bbox_w: number;

  @Column({ nullable: true })
  bbox_x: number;

  @Column({ nullable: true })
  bbox_y: number;
}