#version 150

in vec4 Position;
in vec2 UV0;

uniform mat4 ProjMat;
uniform mat4 ModelViewMat;

out vec2 texCoord;

void main() {
  gl_Position = ProjMat * ModelViewMat * Position;
  texCoord = UV0;
}
