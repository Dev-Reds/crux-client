#version 150

uniform sampler2D DiffuseSampler;
uniform vec2 OutSize;

in vec2 texCoord;
out vec4 fragColor;

void main() {
  vec2 pixel = vec2(1.0) / OutSize;
  vec2 blur = pixel * 3.0;

  vec4 color = texture(DiffuseSampler, texCoord);
  color += texture(DiffuseSampler, texCoord + vec2(blur.x, 0.0));
  color += texture(DiffuseSampler, texCoord - vec2(blur.x, 0.0));
  color += texture(DiffuseSampler, texCoord + vec2(0.0, blur.y));
  color += texture(DiffuseSampler, texCoord - vec2(0.0, blur.y));
  color += texture(DiffuseSampler, texCoord + blur);
  color += texture(DiffuseSampler, texCoord - blur);

  fragColor = color / 7.0;
}
