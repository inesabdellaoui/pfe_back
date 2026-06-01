import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HmiController } from './hmi.controller';
import { HmiService } from './hmi.service';
import { Operateur } from './entities/operateur.entity';
import { SessionOperateur } from './entities/session-operateur.entity';
import { Inspection } from './entities/inspection.entity';
import { Piece } from './entities/piece.entity';
import { GrandePiece } from './entities/grande-piece.entity';



@Module({
  imports: [
    TypeOrmModule.forFeature([
      Operateur,
      SessionOperateur,
      Inspection,
      Piece,
      GrandePiece,
    ])
  ],
  controllers: [HmiController],
  providers  : [HmiService],
})
export class HmiModule {}