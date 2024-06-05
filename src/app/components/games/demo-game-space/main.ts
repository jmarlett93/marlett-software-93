import { AUTO, Game } from 'phaser';
//import { Game as MainGame } from './scenes/Game';
//import { GameOver } from './scenes/GameOver';
//import { MainMenu } from './scenes/MainMenu';
// import additional games via scenes here
import { Boot } from './scenes/boot';
import { GameOver } from './scenes/game-over';
import { Preloader } from './scenes/preloader';
import { SpacePilotGame } from './scenes/space-pilot';
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 768,
  parent: 'game-container',
  backgroundColor: '#028af8',
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  scene: [Boot, Preloader, SpacePilotGame, GameOver],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

export default StartGame;
