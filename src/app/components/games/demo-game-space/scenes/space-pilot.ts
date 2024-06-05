import { Scene } from 'phaser';
import { EventBus } from '../event-bus';

export class SpacePilotGame extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  gameText: Phaser.GameObjects.Text;
  player: Phaser.Physics.Arcade.Sprite;
  physics: Phaser.Physics.Arcade.ArcadePhysics;

  constructor() {
    super('SpacePilotGame');
  }

  create() {
    this.camera = this.cameras.main;

    this.background = this.add.image(512, 384, 'background');

    this.player = this.physics.add
      .sprite(50, 50, 'ship')
      .setScale(0.25)
      .refreshBody();
    this.player.setCollideWorldBounds(true);

    EventBus.emit('current-scene-ready', this);
  }

  changeScene() {
    this.scene.start('GameOver');
  }
}
