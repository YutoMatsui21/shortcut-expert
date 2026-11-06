import imgAppIconKeyboardOutlineTransparent from "./assets/imgAppIconKeyboardOutlineTransparent.svg";
import imgCategoryIcon from "./assets/imgCategoryIcon.svg";
import imgCategoryIcon1 from "./assets/imgCategoryIcon1.svg";
import imgCategoryIcon2 from "./assets/imgCategoryIcon2.svg";
import imgCategoryIcon3 from "./assets/imgCategoryIcon3.svg";
import imgChevronVector from "./assets/imgChevronVector.svg";
import imgChevronVector1 from "./assets/imgChevronVector1.svg";
import imgGroup from "./assets/imgGroup.svg";
import imgHelpIconHover from "./assets/imgHelpIconHover.svg";
import imgIconBookOpen from "./assets/imgIconBookOpen.svg";
import imgIconChart from "./assets/imgIconChart.svg";
import imgInfoIcon from "./assets/imgInfoIcon.svg";
import imgMinus from "./assets/imgMinus.svg";
import imgSquare from "./assets/imgSquare.svg";
import imgStatusIcon from "./assets/imgStatusIcon.svg";
import imgStatusIcon1 from "./assets/imgStatusIcon1.svg";
import imgStatusIcon2 from "./assets/imgStatusIcon2.svg";
import imgStatusIcon3 from "./assets/imgStatusIcon3.svg";
import imgStatusIcon4 from "./assets/imgStatusIcon4.svg";
import imgStatusIcon5 from "./assets/imgStatusIcon5.svg";
import imgXmark from "./assets/imgXmark.svg";
const icons = {
  imgInfoIcon,
  imgStatusIcon,
  imgStatusIcon1,
  imgStatusIcon2,
  imgChevronVector,
  imgChevronVector1,
  imgStatusIcon3,
  imgGroup,
  imgAppIconKeyboardOutlineTransparent,
  imgMinus,
  imgSquare,
  imgXmark,
  imgIconBookOpen,
  imgIconChart,
  imgCategoryIcon,
  imgHelpIconHover,
  imgStatusIcon4,
  imgCategoryIcon1,
  imgCategoryIcon2,
  imgStatusIcon5,
  imgCategoryIcon3,
};
export type IconName = keyof typeof icons;
export function Icon({ name }: { name: IconName }) {
  return (
    <img
      className={"icon " + name}
      src={icons[name]}
      alt=""
      draggable={false}
    />
  );
}
